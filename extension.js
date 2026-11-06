const fs = require('node:fs');
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID } = require('node:crypto');
const { parse } = require('shell-quote');

const SCHEME = 'logtail';

// Zombi process temizliği için global referanslar
let activeDocProvider = null;
const activePtys = new Set(); // Açık Terminal (PTY) süreçlerini takip eder

// ==========================================
// 1. TERMINAL MOTORU (PTY)
// ==========================================
class LogPty {
    constructor(command) {
        this.command = command;
        this.writeEmitter = new vscode.EventEmitter();
        this.closeEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.writeEmitter.event;
        this.onDidClose = this.closeEmitter.event;
        this.process = null;
        
        // PTY instance'ını global takibe al
        activePtys.add(this);
    }

    open() { this.startProcess(); }
    
    close() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        // Kapanan terminali global takipten çıkar
        activePtys.delete(this);
    }

    handleInput(data) {
        if (data === '\x03') { // Ctrl+C
            this.writeEmitter.fire('\r\n\x1b[33m[Logtail] Ctrl+C alındı, süreç durduruluyor...\x1b[0m\r\n');
            this.close();
            this.closeEmitter.fire();
        }
    }

    startProcess() {
        const parsed = parse(this.command);
        const args = parsed.filter(Boolean);
        if (args.length === 0) return;

        const executable = args.shift();
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');
        const formatOutput = (chunk, decoder) => decoder.write(chunk).replace(/\r?\n/g, '\r\n');

        this.writeEmitter.fire(`\x1b[33m$ ${this.command}\x1b[0m\r\n\r\n`);

        try {
            this.process = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            this.writeEmitter.fire(`\r\n\x1b[31m[Spawn Hatası] ${error.message}\x1b[0m\r\n`);
            return;
        }

        this.process.stdout.on('data', chunk => this.writeEmitter.fire(formatOutput(chunk, stdoutDecoder)));
        this.process.stderr.on('data', chunk => this.writeEmitter.fire(`\x1b[31m${formatOutput(chunk, stderrDecoder)}\x1b[0m`));
        this.process.on('error', error => this.writeEmitter.fire(`\r\n\x1b[31m[Process Hatası] ${error.message}\x1b[0m\r\n`));
        
        this.process.on('close', (code) => {
            const outRemain = stdoutDecoder.end();
            const errRemain = stderrDecoder.end();
            if (outRemain) this.writeEmitter.fire(outRemain.replace(/\r?\n/g, '\r\n'));
            if (errRemain) this.writeEmitter.fire(errRemain.replace(/\r?\n/g, '\r\n'));
            this.writeEmitter.fire(`\r\n\x1b[33m[Logtail] Süreç kapandı (Code: ${code})\x1b[0m\r\n`);
            this.process = null;
        });
    }
}

// ==========================================
// 2. EDITOR MOTORU (Virtual Document)
// ==========================================
class LogDocumentProvider {
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        this.sessions = new Map();
        this.emitter = new vscode.EventEmitter();
        this.onDidChange = this.emitter.event;
    }

    createSession(command, maxChars) {
        const id = randomUUID();
        const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/stream.log` });
        const session = { 
            id, uri, command, maxChars, 
            content: `$ ${command}\n[Buffer Limit: ${maxChars === 0 ? 'Sınırsız' : maxChars}]\n\n`, 
            process: null, flushTimer: null, stopping: false, ended: false 
        };
        this.sessions.set(uri.toString(), session);
        return session;
    }

    provideTextDocumentContent(uri) {
        return this.sessions.get(uri.toString())?.content ?? '[Logtail] Session not found.';
    }

    append(session, text) {
        if (!text || session.ended) return;
        session.content += text;
        this.outputChannel.append(text);

        if (session.maxChars > 0 && session.content.length > session.maxChars) {
            const overflow = session.content.length - session.maxChars;
            const nextLine = session.content.indexOf('\n', overflow);
            session.content = session.content.slice(nextLine >= 0 ? nextLine + 1 : overflow);
        }
        this.scheduleRefresh(session);
    }

    scheduleRefresh(session) {
        if (session.flushTimer || session.disposed) return;
        session.flushTimer = setTimeout(() => {
            session.flushTimer = null;
            if (!session.disposed) this.emitter.fire(session.uri);
        }, 100);
    }

    startProcess(session, command) {
        const parsed = parse(command);
        const args = parsed.filter(Boolean);
        const executable = args.shift();
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');

        this.append(session, `[Diagnostics] CWD: ${process.cwd()}\n`);

        try {
            session.process = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            this.append(session, `\n[Spawn Hatası] ${error.message}\n`);
            session.ended = true;
            return;
        }

        session.process.stdout.on('data', chunk => this.append(session, stdoutDecoder.write(chunk)));
        session.process.stderr.on('data', chunk => this.append(session, stderrDecoder.write(chunk)));
        session.process.on('error', error => {
            this.append(session, `\n[Process Hatası] ${error.message}\n`);
            session.ended = true;
            session.process = null;
        });
        session.process.on('close', (code) => {
            this.append(session, stdoutDecoder.end() + stderrDecoder.end());
            session.ended = true;
            session.process = null;
            this.append(session, `\n[Logtail] Süreç kapandı (Code: ${code})\n`);
        });
    }

    stopSession(uri) {
        const session = this.sessions.get(uri.toString());
        if (session && session.process && !session.stopping) {
            session.stopping = true;
            session.process.kill();
        }
    }

    disposeSession(uri) {
        this.stopSession(uri);
        this.sessions.delete(uri.toString());
    }

    disposeAll() {
        for (const [uriStr, session] of this.sessions.entries()) {
            if (session.process && !session.stopping) {
                session.process.kill();
            }
        }
        this.sessions.clear();
    }
}

// ==========================================
// 3. AKTİVASYON VE YÖNLENDİRME (Router)
// ==========================================
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('Logtail Stream');
    context.subscriptions.push(outputChannel);

    activeDocProvider = new LogDocumentProvider(outputChannel);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, activeDocProvider));

    // Editor sekmesi çarpıdan (X) kapatılırsa süreci durdurur
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === SCHEME) activeDocProvider.disposeSession(document.uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('logtail.start', async () => {
            const viewTarget = await vscode.window.showQuickPick(
                [
                    { label: '$(output) Editor Sekmesi', description: 'Logları metin dosyasında açar', target: 'editor' },
                    { label: '$(terminal) Terminal (PTY)', description: 'Logları renkli formatta terminalde açar', target: 'terminal' }
                ],
                { placeHolder: 'Loglar nerede gösterilsin?' }
            );

            if (!viewTarget) return;

            const command = await vscode.window.showInputBox({
                title: 'Logtail - Komutu Girin',
                placeHolder: 'journalctl -f -u docker',
                ignoreFocusOut: true
            });

            if (!command || !command.trim()) return;

            if (viewTarget.target === 'terminal') {
                const pty = new LogPty(command.trim());
                const terminal = vscode.window.createTerminal({ name: `Log: ${command.split(' ')[0]}`, pty: pty });
                terminal.show();
                // Not: Terminal çöp kutusuna tıklanarak kapatılırsa pty.close() API tarafından otomatik tetiklenir.
            } else {
                const limitInput = await vscode.window.showInputBox({
                    title: 'Logtail - Buffer Limiti',
                    prompt: 'Maksimum karakter sınırı (Sınırsız için 0 yazın, Editörü kilitleyebilir)',
                    value: '2000000',
                    ignoreFocusOut: true
                });

                if (limitInput === undefined) return; 
                
                let maxChars = parseInt(limitInput, 10);
                if (isNaN(maxChars) || maxChars < 0) maxChars = 2000000;

                let session = activeDocProvider.createSession(command.trim(), maxChars);
                outputChannel.show(true);
                await vscode.window.showTextDocument(session.uri, { viewColumn: vscode.ViewColumn.Active, preview: false });
                activeDocProvider.startProcess(session, command.trim());
            }
        })
    );

    // Manual stop komutu
    context.subscriptions.push(
        vscode.commands.registerCommand('logtail.stop', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === SCHEME) {
                activeDocProvider.stopSession(editor.document.uri);
            }
        })
    );
}

function deactivate() {
    // VSCode penceresi aniden ("X" ile) komple kapatıldığında Editor zombilerini temizle
    if (activeDocProvider) {
        activeDocProvider.disposeAll();
    }
    
    // VSCode penceresi aniden komple kapatıldığında Terminal (PTY) zombilerini temizle
    for (const pty of activePtys) {
        pty.close();
    }
}

module.exports = { activate, deactivate };
