İşte şimdi güzel bir araç yazıyoruz! Ben bu uzantıya Logtail adını verirdim. Çünkü yalnızca journalctl değil, herhangi bir komutun çıktısını canlı izleyebilecek.

Ve bence en önemli tasarım kararımız şu:

Terminal çıktısını bir editöre kopyalamayacağız. Editörün kendisini canlı bir akışın görüntüleyicisi yapacağız.

Böylece VS Code'un kendi editör yeteneklerinden yararlanacağız:
- Ctrl+F: Metin ara.
- Ctrl+H: Bul ve değiştir (belge salt okunur olacağı için değiştirme işlemi kısıtlı).
- Regex ile arama.
- Satıra git.
- Seç, kopyala, başka yere yapıştır.
- Birden fazla log akışını ayrı sekmelerde izle.
Üstelik terminal paneli açılmayacak.
1. Önce mimariyi belirleyelim
Ben dört parçalı bir yapı kuracağım:
Logtail Extension

VS Code komutları ve kullanıcı arayüzü


Command Input

Kullanıcının girdiği komut
journalctl -f -u docker


tail -f /var/log/syslog


kubectl logs -f -n production pod/my-app




Process Manager

Node.js child_process.spawn()
- Komutu başlatır.
- stdout / stderr okur.
- Süreç kimliğini takip eder.
- Durdurma ve hata yönetimini yapar.


Live Document Provider

VS Code TextDocumentContentProvider
- Çıktıyı bellekte tutar.
- Yeni veri geldikçe belgeyi yeniler.
- Her akışa ayrı bir URI verir.


VS Code Editor

Live

logtail://session-001/docker.log


Normal editör deneyimi, canlı güncellenen metin belgesi.


Neden TextDocumentContentProvider?
Burada kritik bir teknik ayrım var.

VS Code'un TextDocument nesnesi, uzantının istediği zaman doğrudan değiştirebileceği bir metin alanı değil.

Bunun yerine TextDocumentContentProvider kullanacağız.

Bu API bize şu imkânı verir:
1. Kendimize ait logtail:// şeması tanımlarız.
2. Her log oturumu için ayrı bir belge URI'si oluştururuz.
3. Gelen veriyi bellekte biriktiririz.
4. onDidChange olayıyla VS Code'a belge içeriğinin değiştiğini bildiririz.
5. VS Code belgeyi yeniden okur ve editörde gösterir.
Böylece editör gerçekten canlı bir belge olur. Webview kullanmamıza gerek yok. Webview kullansaydık VS Code'un normal metin arama ve seçme yeteneklerinden uzaklaşacaktık.
2. Logtail'ın ilk sürümünde neler olacak?
İlk sürümün kapsamını fazla şişirmeyelim. Ama sağlam bir temel atalım.
Özellik	İlk sürüm
Komutu kullanıcıdan alma	Var
stdout ve stderr okuma	Var
Sürekli veri akışı	Var
Her akış için ayrı sekme	Var
Birden fazla eşzamanlı akış	Var
Sekmeyi kapatınca süreci durdurma	Var
Elle durdurma komutu	Var
Bellekteki log miktarına sınır	Var
Regex arama	VS Code'un kendi özelliği
Komut geçmişi	Sonraki sürüm
Renkli log ayrıştırma	Sonraki sürüm
Filtreleme ve vurgulama	Sonraki sürüm

Bir tasarım kararı daha: İlk sürümde her komut için bir işletim sistemi süreci oluşturacağız. Süreçleri birbirinden bağımsız yöneteceğiz.

Örneğin üç sekme açarsan:
Logtail
│
├── docker.log       PID 1234
├── kubernetes.log   PID 1250
└── syslog.log       PID 1280


Üçü de aynı anda çalışabilir. Birini durdurman diğerlerini etkilemez.
Komut güvenliği
Kullanıcıdan komut alacağız ama shell: true kullanmayacağız.

Örneğin:
kubectl logs -f -n production my-app


şu şekilde ayrıştırılacak:
Executable: kubectl

Arguments:
  logs
  -f
  -n
  production
  my-app


Bunun için shell-quote kullanacağız. Böylece tırnaklı argümanları da destekleriz. İlk sürümde |, &&, > gibi kabuk işleçlerini reddedeceğiz. Bunlar için ayrı bir güvenlik ve komut çalıştırma tasarımı gerekir.

Küçük bir Kubernetes düzeltmesi: kubectl logs komutunda Pod adı doğrudan verilir; pod kelimesi araya girmez:
kubectl logs -f -n production my-app



3. Proje dosyalarını oluşturalım
JavaScript ile başlayalım. TypeScript'e geçmek istersek mimariyi değiştirmemiz gerekmeyecek.

Proje ağacı:
logtail/
│
├── package.json
├── extension.js
└── .vscode/
    └── launch.json


package.json

{
  "name": "logtail",
  "displayName": "Logtail",
  "description": "Stream command output into live VS Code editor tabs",
  "version": "0.1.0",
  "publisher": "cemoka",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": [
    "Other"
  ],
  "main": "./extension.js",
  "activationEvents": [
    "onCommand:logtail.start",
    "onCommand:logtail.stop"
  ],
  "dependencies": {
    "shell-quote": "^1.8.2"
  },
  "contributes": {
    "commands": [
      {
        "command": "logtail.start",
        "title": "Logtail: Start Log Stream",
        "icon": "$(play)"
      },
      {
        "command": "logtail.stop",
        "title": "Logtail: Stop Current Stream",
        "icon": "$(debug-stop)"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "logtail.stop",
          "when": "resourceScheme == logtail",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "Logtail",
      "properties": {
        "logtail.maxBufferChars": {
          "type": "number",
          "default": 2000000,
          "minimum": 10000,
          "description": "Maximum number of characters retained per log session."
        },
        "logtail.refreshInterval": {
          "type": "number",
          "default": 100,
          "minimum": 50,
          "description": "Editor refresh interval in milliseconds."
        }
      }
    }
  }
}



extension.js
Şimdi asıl motoru yazıyoruz.

Bu kodda üç sınıf değil, başlangıçta tek bir sağlayıcı ve birkaç yardımcı işlev kullanacağım. Gereksiz soyutlama yapmayalım; ama süreç yönetimini belge yönetiminden ayıracak şekilde düzenleyelim.

const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID } = require('node:crypto');
const { parse } = require('shell-quote');

const SCHEME = 'logtail';

function activate(context) {

    const provider = new LogDocumentProvider();

    // Register virtual document provider
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            SCHEME,
            provider
        )
    );

    // Release sessions when their editor tabs are closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === SCHEME) {
                provider.disposeSession(document.uri);
            }
        })
    );

    // Start a new log stream
    context.subscriptions.push(
        vscode.commands.registerCommand('logtail.start', async () => {

            const command = await vscode.window.showInputBox({
                title: 'Logtail - Start Log Stream',
                prompt: 'Enter a command to stream its output',
                placeHolder:
                    'journalctl -f -u docker',
                ignoreFocusOut: true
            });

            if (!command || !command.trim()) {
                return;
            }

            try {
                const session = provider.createSession(command.trim());

                provider.startProcess(session, command.trim());

                await vscode.window.showTextDocument(
                    session.uri,
                    {
                        viewColumn: vscode.ViewColumn.Active,
                        preview: false
                    }
                );

            } catch (error) {
                vscode.window.showErrorMessage(
                    `Logtail: ${error.message}`
                );
            }
        })
    );

    // Stop the stream belonging to the active editor
    context.subscriptions.push(
        vscode.commands.registerCommand('logtail.stop', () => {

            const editor = vscode.window.activeTextEditor;

            if (!editor || editor.document.uri.scheme !== SCHEME) {
                vscode.window.showWarningMessage(
                    'Logtail: No active log stream.'
                );
                return;
            }

            provider.stopSession(editor.document.uri);
        })
    );

    context.subscriptions.push(provider);
}

function deactivate() {}


/**
 * Manages virtual log documents and their processes.
 */
class LogDocumentProvider {

    constructor() {
        this.sessions = new Map();

        this.emitter = new vscode.EventEmitter();
        this.onDidChange = this.emitter.event;
    }

    /**
     * Create a new virtual document session.
     */
    createSession(command) {

        const id = randomUUID();

        const executable = command.split(/\s+/)[0]
            .split(/[\\/]/).pop();

        const uri = vscode.Uri.from({
            scheme: SCHEME,
            path: `/${id}/${executable}.log`
        });

        const session = {
            id,
            uri,
            command,
            content: `$ ${command}\n\n`,
            process: null,
            flushTimer: null,
            stopping: false,
            ended: false
        };

        this.sessions.set(uri.toString(), session);

        return session;
    }

    /**
     * Called by VS Code whenever the document is opened or refreshed.
     */
    provideTextDocumentContent(uri) {

        const session = this.sessions.get(uri.toString());

        return session
            ? session.content
            : '[Logtail] Session not found.';
    }

    /**
     * Append incoming process output.
     */
    append(session, text) {

        if (!text || session.ended) {
            return;
        }

        session.content += text;

        const maxChars = vscode.workspace
            .getConfiguration('logtail')
            .get('maxBufferChars', 2000000);

        // Keep the newest portion of the log.
        if (session.content.length > maxChars) {

            const overflow = session.content.length - maxChars;

            const nextLine = session.content.indexOf(
                '\n',
                overflow
            );

            session.content = session.content.slice(
                nextLine >= 0 ? nextLine + 1 : overflow
            );
        }

        this.scheduleRefresh(session);
    }

    /**
     * Avoid refreshing the editor for every individual data chunk.
     */
    scheduleRefresh(session) {

        if (session.flushTimer) {
            return;
        }

        const interval = vscode.workspace
            .getConfiguration('logtail')
            .get('refreshInterval', 100);

        session.flushTimer = setTimeout(() => {

            session.flushTimer = null;

            this.emitter.fire(session.uri);

        }, interval);
    }

    /**
     * Parse and launch the requested command.
     */
    startProcess(session, command) {

        const parsed = parse(command);

        // Shell operators, substitutions and other non-argument tokens
        // are intentionally not supported in this version.
        if (parsed.some(item => typeof item !== 'string')) {
            throw new Error(
                'Shell operators and expansions are not supported. ' +
                'Enter an executable followed by its arguments.'
            );
        }

        const args = parsed.filter(Boolean);

        if (args.length === 0) {
            throw new Error('Empty command.');
        }

        const executable = args.shift();

        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;

        const options = {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        };

        if (cwd?.scheme === 'file') {
            options.cwd = cwd.fsPath;
        }

        const child = spawn(executable, args, options);

        session.process = child;

        child.stdout.on('data', chunk => {
            this.append(
                session,
                stdoutDecoder.write(chunk)
            );
        });

        child.stderr.on('data', chunk => {
            this.append(
                session,
                stderrDecoder.write(chunk)
            );
        });

        child.on('error', error => {

            this.append(
                session,
                `\n[Logtail error] ${error.message}\n`
            );

            session.ended = true;
            session.process = null;
        });

        child.on('close', (code, signal) => {

            this.append(
                session,
                stdoutDecoder.end()
            );

            this.append(
                session,
                stderrDecoder.end()
            );

            const reason = session.stopping
                ? 'Stopped'
                : `Process exited (code: ${code}, signal: ${signal})`;

            session.ended = true;
            session.process = null;

            session.content += `\n[Logtail] ${reason}\n`;

            this.scheduleRefresh(session);
        });
    }

    /**
     * Stop one session without affecting other sessions.
     */
    stopSession(uri) {

        const session = this.sessions.get(uri.toString());

        if (!session || !session.process || session.stopping) {
            vscode.window.showInformationMessage(
                'Logtail: Stream is not running.'
            );
            return;
        }

        session.stopping = true;

        session.process.kill();

        vscode.window.showInformationMessage(
            'Logtail: Stopping stream...'
        );
    }

    /**
     * Release a session when its document is closed.
     */
    disposeSession(uri) {

        const key = uri.toString();
        const session = this.sessions.get(key);

        if (!session) {
            return;
        }

        if (session.flushTimer) {
            clearTimeout(session.flushTimer);
        }

        if (session.process && !session.stopping) {
            session.stopping = true;
            session.process.kill();
        }

        this.sessions.delete(key);
    }

    /**
     * Extension shutdown.
     */
    dispose() {

        for (const session of this.sessions.values()) {

            if (session.flushTimer) {
                clearTimeout(session.flushTimer);
            }

            if (session.process) {
                session.process.kill();
            }
        }

        this.sessions.clear();
        this.emitter.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};



4. Debug yapılandırması
.vscode/launch.json:

{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Logtail Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath",
        "${workspaceFolder}"
      ]
    }
  ]
}



5. Çalıştırıp deneyelim
Proje klasöründe:
npm install


Ardından VS Code'da F5.

Açılan Extension Development Host içerisinde:
1. Ctrl + Shift + P
2. Logtail: Start Log Stream
3. Komutunu gir.
İlk deneme için:
journalctl -f -u docker


Ardından ikinci bir sekme aç:
kubectl logs -f -n production my-app


Üçüncü sekme:
tail -f /var/log/syslog









about.gitlab.com


Artık her sekme bağımsız bir log akışını gösterecek.

Sekmeyi kapattığında ilgili süreç durdurulacak. Sekmenin üstündeki durdurma simgesiyle de akışı sonlandırabileceksin.

Remote SSH notu: Linux sunucusundaki journalctl ve kubectl komutlarını çalıştırmak istiyorsan Logtail uzantısını Remote SSH ortamına kurmalısın. Böylece süreç Windows'ta değil, uzaktaki Linux Extension Host üzerinde çalışır.
6. İlk sürümün bilinen sınırları
Bunları özellikle şimdiden kayda geçirelim:
- Sanal belge salt okunur. Ctrl+F ve regex araması çalışır; Ctrl+H ile belgeyi değiştiremeyiz.
- Her güncellemede belge içeriğinin tamamı VS Code'a sunulur. Bu nedenle 2 milyon karakterlik bir bellek sınırı koyduk.
- Yenileme varsayılan olarak 100 ms. Her veri parçasında editörü yenilemiyoruz.
- Komut satırında pipe, redirect ve shell expansion henüz desteklenmiyor.
- Çıktı diske kaydedilmiyor; sekme kapandığında oturumun belleği serbest bırakılıyor.
Bunlar ilk sürüm için makul sınırlar. İleride daha büyük log hacimleri için satır tabanlı saklama, sanal kaydırma ve farklı bir görüntüleme yaklaşımı düşünebiliriz.

7. Bundan sonraki mimari geliştirme sırası
Ben şu üç konuyu özellikle önemsiyorum:

1. Session Manager

Her akışın bir kimliği, komutu, çalışma durumu, süreç kimliği ve belgesi olmalı. Şimdiki kod bunun ilk temelini atıyor.

2. Command History

Daha önce çalıştırdığın komutları yeniden yazmadan seçebilmelisin.

3. Log Filtering

Örneğin yalnızca ERROR, WARN, Exception içeren satırları göstermek veya belirli bir regex ile filtrelemek.

Bir de benim özellikle istediğim bir özellik var: Filtreleme yaparken kaynak akışın kendisini değiştirmemek. Yani ham log akışı ile kullanıcının gördüğü süzülmüş görünüm birbirinden ayrılmalı.

Kaynak: VS Code'un resmi Virtual Documents API belgesi ve Extension API başvurusu.

