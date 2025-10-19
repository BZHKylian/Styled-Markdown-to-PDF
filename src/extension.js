"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const showdown = __importStar(require("showdown"));
const puppeteer_1 = __importDefault(require("puppeteer"));
function activate(context) {
    // 🔹 Lecture des options depuis les settings
    let generateToc = vscode.workspace.getConfiguration('mdToPdf').get('generateToc', true);
    // Commande pour activer / désactiver le TOC
    context.subscriptions.push(vscode.commands.registerCommand('BZHKylian.toggleToc', async () => {
        generateToc = !generateToc;
        await vscode.workspace.getConfiguration('mdToPdf').update('generateToc', generateToc, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Sommaire interactif ${generateToc ? 'activé' : 'désactivé'}`);
    }));
    // Commande principale pour générer le PDF
    const disposable = vscode.commands.registerCommand('BZHKylian.mdToPdf', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Aucun fichier ouvert.');
            return;
        }
        const doc = editor.document;
        if (doc.languageId !== 'markdown') {
            vscode.window.showErrorMessage('Ce fichier n’est pas un fichier Markdown.');
            return;
        }
        const baseDir = path.dirname(doc.uri.fsPath);
        const fileName = path.basename(doc.uri.fsPath, '.md');
        // 🔹 Sauvegarde du Markdown pour debug
        const markdown = doc.getText();
        const debugMdPath = path.join(baseDir, '_debug.md');
        fs.writeFileSync(debugMdPath, markdown, 'utf-8');
        // 🔹 Extraction de la page de garde (si présente)
        const { coverHtml, markdown: cleanMarkdown } = extractCoverData(markdown);
        // Extensions Markdown personnalisées
        const customExtensions = () => [
            {
                type: 'output',
                regex: /:::(?:([a-zA-Z]+)?(?:\[(.*?)\])?)?\n([\s\S]*?):::/g,
                replace: (match, type, title, content) => {
                    const noteType = type ? type.trim().toLowerCase() : 'note';
                    const noteTitle = title ? title : (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Note');
                    return `
            <div class="note ${noteType}">
              <strong class="note-title">${noteTitle}</strong>
              <div class="note-content">${content.trim()}</div>
            </div>
          `;
                }
            },
            { type: 'lang', regex: /==([^=]+)==/g, replace: '<mark>$1</mark>' },
            { type: 'lang', regex: /\+\+([^+]+)\+\+/g, replace: '<u>$1</u>' }
        ];
        const converter = new showdown.Converter({
            tables: true,
            extensions: [customExtensions()],
            literalMidWordUnderscores: true,
            ghCodeBlocks: true,
            encodeHtml: false
        });
        let htmlContent = converter.makeHtml(cleanMarkdown);
        // 🔹 Génération TOC si activée
        let tocHtml = '';
        if (generateToc) {
            const tocData = generateTOC(htmlContent);
            htmlContent = tocData.html;
            tocHtml = tocData.toc;
        }
        // 🔹 Génération du HTML final
        const fullHtml = `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 40px; color: #333; line-height: 1.6; }
            h1,h2,h3,h4 { color: #222; }
            h1 { border-bottom: 2px solid #000; padding-bottom: 0.3em; text-align: center; }
            mark { background-color: #fff3a3; padding: 0 3px; border-radius: 3px; }
            u { text-decoration: underline; text-decoration-thickness: 1.5px; }
            img { max-width: 100%; height: auto; display: block; margin: 1em 0; }
            pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow-x: auto; }
            code { background: #f3f3f3; padding: 2px 4px; border-radius: 3px; font-family: monospace; }

            .note { border-left: 5px solid #ccc; padding: 10px 15px; margin: 1.2em 0; border-radius: 6px; background: #f9f9f9; }
            .note.info { border-color: #3b82f6; background: #e0f0ff; }
            .note.success { border-color: #16a34a; background: #e6f9ed; }
            .note.warning { border-color: #f59e0b; background: #fff7e5; }
            .note.error { border-color: #dc2626; background: #ffeaea; }
            .note-title { display: block; font-weight: bold; margin-bottom: 0.3em; }

            .toc { border: 1px solid #ccc; padding: 10px 15px; margin-bottom: 20px; background: #f9f9f9; border-radius: 6px; page-break-after: always; }
            .toc ul { list-style: none; padding-left: 0; }
            .toc li { margin: 5px 0; }
            .toc a { text-decoration: none; color: #3b82f6; }
            .toc a:hover { text-decoration: underline; }

            /* 🔹 Suppression header/footer sur page de garde et sommaire */
            @page:first {
              margin-top: 0;
              margin-bottom: 0;
            }
            .cover-page {
              page: cover;
              page-break-after: always;
            }
            @page cover {
              margin: 0;
            }
            @page toc {
              margin: 0;
            }
            .toc {
              page: toc;
            }
          </style>
        </head>
        <body>
          ${coverHtml}
          ${tocHtml}
          ${htmlContent}
        </body>
      </html>
    `;
        const outputPath = path.join(baseDir, `${fileName}.pdf`);
        const tempHtmlPath = path.join(baseDir, '_temp_mdtopdf.html');
        fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');
        try {
            const browser = await puppeteer_1.default.launch();
            const page = await browser.newPage();
            await page.goto('file://' + tempHtmlPath, { waitUntil: 'networkidle0' });
            const today = new Date().toLocaleDateString('fr-FR', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });
            await page.pdf({
                path: outputPath,
                format: 'A4',
                printBackground: true,
                displayHeaderFooter: true,
                margin: { top: '70px', bottom: '60px', left: '30px', right: '30px' },
                headerTemplate: `
          <div style="font-size:10px;width:100%;padding:5px 30px;color:#666;display:flex;justify-content:space-between;font-family:'Helvetica Neue', Arial, sans-serif;">
            <span>${fileName}.md</span><span>${today}</span>
          </div>
        `,
                footerTemplate: `
          <div style="font-size:10px;width:100%;text-align:center;color:#666;padding-top:5px;font-family:'Helvetica Neue', Arial, sans-serif;">
            Page <span class="pageNumber"></span> sur <span class="totalPages"></span>
          </div>
        `,
            });
            await browser.close();
            fs.unlinkSync(tempHtmlPath);
            vscode.window.showInformationMessage(`✅ PDF créé avec succès : ${outputPath}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`❌ Erreur lors de la génération du PDF : ${err}`);
        }
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
// 🔹 Génère TOC et retourne { toc, html }
function generateTOC(htmlContent) {
    let toc = '<nav class="toc"><h2>Sommaire</h2><ul>';
    const headingRegex = /<h([1-3])>(.*?)<\/h\1>/g;
    let match;
    let idCounter = 1;
    while ((match = headingRegex.exec(htmlContent)) !== null) {
        const level = parseInt(match[1]);
        const text = match[2].trim();
        const id = 'heading-' + idCounter++;
        htmlContent = htmlContent.replace(match[0], `<h${level} id="${id}">${text}</h${level}>`);
        toc += `<li style="margin-left:${(level - 1) * 20}px"><a href="#${id}">${text}</a></li>`;
    }
    toc += '</ul></nav>';
    return { toc, html: htmlContent };
}
// 🔹 Extraction et génération de la page de garde
function extractCoverData(markdown) {
    const coverRegex = /^:::cover\s*([\s\S]*?):::/m;
    const match = markdown.match(coverRegex);
    if (!match) {
        return { coverHtml: '', markdown };
    }
    const coverBlock = match[1].trim();
    const lines = coverBlock.split('\n').map(l => l.trim()).filter(Boolean);
    const config = {};
    for (const line of lines) {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) {
            config[key.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
        }
    }
    const title = config.title || 'Document';
    const subtitle = config.subtitle || '';
    const author = config.author || '';
    const date = config.date === 'auto'
        ? new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : (config.date || '');
    const background = config.background || '#ffffff';
    const textColor = config.textColor || '#000000';
    const accentColor = config.accentColor || '#2563eb';
    const align = config.align || 'center';
    const logo = config.logo ? `file:///${path.resolve(config.logo).replace(/\\/g, '/')}` : '';
    const coverHtml = `
    <div class="cover-page" style="
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: ${align};
      height: 10090vh;
      background: ${background};
      color: ${textColor};
      text-align: ${align};
      font-family: 'Helvetica Neue', Arial, sans-serif;
    ">
      ${logo ? `<img src="${logo}" alt="Logo" style="max-width: 180px; margin-bottom: 40px;" />` : ''}
      <h1 style="font-size: 2.8em; margin-bottom: 0.3em; color: ${accentColor};">${title}</h1>
      ${subtitle ? `<h2 style="font-size: 1.6em; margin-bottom: 0.8em;">${subtitle}</h2>` : ''}
      ${author ? `<p style="font-size: 1.2em; margin-bottom: 0.3em;">${author}</p>` : ''}
      ${date ? `<p style="font-size: 1.1em; color: #555;">${date}</p>` : ''}
    </div>
  `;
    const newMarkdown = markdown.replace(coverRegex, '').trim();
    return { coverHtml, markdown: newMarkdown };
}
