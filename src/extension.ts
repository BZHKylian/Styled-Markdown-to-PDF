import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as showdown from 'showdown';
import puppeteer from 'puppeteer';

console.log('test');
const hljs = require('highlight.js');

const PDFMergerModule = require('pdf-merger-js');
const PDFMerger = PDFMergerModule.default || PDFMergerModule;

export function activate(context: vscode.ExtensionContext) {
  let isDarkMode = true;

  const toggleTheme = vscode.commands.registerCommand('styledMdPdf.theme.toggleCodeBlock', () => {
    isDarkMode = !isDarkMode;
    vscode.window.showInformationMessage(`PDF Code Block Theme: ${isDarkMode ? 'Dark' : 'Light'}`);
  });

  const disposable = vscode.commands.registerCommand('styledMdPdf.export.mdToPdf', async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No files open.');
      return;
    }

    const doc = editor.document;
    if (doc.languageId !== 'markdown') {
      vscode.window.showErrorMessage('This file is not Markdown.');
      return;
    }

    const baseDir = path.dirname(doc.uri.fsPath);
    const fileName = path.basename(doc.uri.fsPath, '.md');
    const markdown = doc.getText();

    const { coverHtml, markdown: cleanMarkdown } = extractCoverData(markdown);
    const hasCover = !!coverHtml;

    // === Extensions Markdown personnalisées ===
    const customExtensions = (): showdown.ShowdownExtension[] => [
      {
        type: 'output',
        regex: /:::(?:([a-zA-Z]+)?(?:\[(.*?)\])?)?\n([\s\S]*?):::/g,
        replace: (_m: string, type: string, title: string, content: string) => {
          const noteType = type ? type.trim().toLowerCase() : 'note';
          if (['cover', 'headerpdf', 'pagebreak'].includes(noteType)) {
            return '';
          }

          const noteTitle = title || (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Note');
          return `
            <div class="note ${noteType}">
              <strong class="note-title">${noteTitle}</strong>
              <div class="note-content">${content.trim()}</div>
            </div>
          `;
        },
      },
      {
        type: 'lang',
        regex: /^\s*\[([ xX])\]\s*(.*)$/gm,
        replace: (_m: string, checked: string, text: string) => {
          const isChecked = checked.toLowerCase() === 'x';
          return `<label style="display:flex;align-items:center;gap:6px;margin:2px 0;">
            <input type="checkbox" disabled ${isChecked ? 'checked' : ''} />
            <span>${text}</span>
          </label>`;
        },
      },
      {
        type: 'lang',
        regex: /==([^=]+)==(?:\(([^)]+)\))?/g,
        replace: (_m: string, text: string, color: string) => {
          const finalColor = color || 'yellow';
          return `<mark style="background-color:${finalColor}">${text}</mark>`;
        },
      },
      { type: 'lang', regex: /^:::pagebreak:::/gm, replace: '<div class="pagebreak"></div>' },
      { type: 'lang', regex: /\+\+([^+]+)\+\+/g, replace: '<u>$1</u>' },
    ];

    // === Conversion Markdown → HTML ===
    const converter = new showdown.Converter({
      tables: true,
      extensions: [customExtensions()],
      literalMidWordUnderscores: true,
      ghCodeBlocks: true,
      encodeHtml: false,
    });

    let htmlContent = converter.makeHtml(cleanMarkdown);

    htmlContent = htmlContent.replace(
      /<pre><code(?: class="([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_match: string, langClass: string, innerCode: string) => {
        const language = (langClass || '').replace(/.*language-/, '').trim();
        let highlighted: string;
        console.log(language)

        try {
          // 1️⃣ Highlight complet
          highlighted = language && hljs.getLanguage(language)
            ? hljs.highlight(innerCode, { language }).value
            : hljs.highlightAuto(innerCode).value;

          // 2️⃣ Post-traitement : tout ce qui est avant = devient variable
          highlighted = highlighted.split('\n').map(lineHtml => {
            const textOnly = lineHtml.replace(/<[^>]+>/g, ''); // texte brut pour trouver =
            const equalIndex = textOnly.indexOf('=');
            if (equalIndex > 0) {
              const beforeEqual = textOnly.slice(0, equalIndex).trim();
              if (beforeEqual) {
                const escaped = beforeEqual.replace(/([.*+?^${}()|\[\]\/\\])/g, '\\$1');
                lineHtml = lineHtml.replace(new RegExp(`\\b${escaped}\\b`), `<span class="hljs-attr">${beforeEqual}</span>`);
              }
            }

            // 3️⃣ Post-traitement commentaires
            if (/^\s*(#|\/\/)/.test(textOnly)) {
              return `<span class="custom-comment">${lineHtml}</span>`;
            }
            return lineHtml;
          }).join('\n');

        } catch {
          highlighted = innerCode;
        }

        // 4️⃣ Retour avec conteneur div pour le nom du langage
        return `
      <div class="code-block-wrapper" style="position: relative;">
        <div class="code-language-label">
          ${language || 'auto'}
        </div>
        <pre><code class="hljs ${language}">${highlighted}</code></pre>
      </div>
    `;
      }
    );

    /** === Extraction du bloc :::headerPdf === */
    const headerMatchMd = markdown.match(/^:::headerPdf\s*([\s\S]*?):::/m);
    let headerTitle = fileName;
    let headerDate = '';
    let headerLogo = '';

    if (headerMatchMd) {
      const lines = headerMatchMd[1].split('\n').map((l: string) => l.trim()).filter(Boolean);
      const config: Record<string, string> = {};
      for (const line of lines) {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) config[key.trim().toLowerCase()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
      }

      headerTitle = config.title || fileName;
      headerDate = config.date === 'auto'
        ? new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
        : (config.date || '');
      if (config.logo && config.logo.trim()) {
        const absoluteLogoPath = path.resolve(baseDir, config.logo);
        if (fs.existsSync(absoluteLogoPath)) {
          const imgData = fs.readFileSync(absoluteLogoPath);
          const ext = path.extname(absoluteLogoPath).substring(1);
          headerLogo = `data:image/${ext};base64,${imgData.toString('base64')}`;
        }
      }
    }

    htmlContent = htmlContent.replace(/<div class="pdf-header-config">[\s\S]*?<\/div>/, '');
    htmlContent = htmlContent.replace(/<p><\/p>/, '');
    /** === Génération PDF === */
    try {
      const browser = await puppeteer.launch();
      const cssPath = path.join(__dirname, '..', 'styles', 'style.css');
      const cssFileUrl = `file://${cssPath.split(path.sep).join('/')}`;

      const hljsCssFile = isDarkMode ? 'github-dark.css' : 'github.css';
      const hljsCssPath = path.join(__dirname, '..', 'node_modules', 'highlight.js', 'styles', hljsCssFile);
      const hljsCssUrl = `file://${hljsCssPath.split(path.sep).join('/')}`;


      // Page de garde
      if (hasCover) {
        const coverHtmlFull = `
        <!DOCTYPE html>
        <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <link rel="stylesheet" href="${cssFileUrl}">
          </head>
        <body>
          ${coverHtml}
        </body>
        </html>`;
        const coverTempPath = path.join(baseDir, '_cover.html');
        fs.writeFileSync(coverTempPath, coverHtmlFull, 'utf-8');
        const pageCover = await browser.newPage();
        await pageCover.goto('file://' + coverTempPath, { waitUntil: 'networkidle0' });
        await pageCover.pdf({ path: path.join(baseDir, '_cover.pdf'), format: 'A4', printBackground: true });
        await pageCover.close();
        fs.unlinkSync(coverTempPath);
      }

      // package.json est un niveau au-dessus du dossier "out" ou "dist"
      const packageJsonPath = path.join(__dirname, '..', 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // Contenu principal
      const contentHtmlFull = `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <link rel="stylesheet" href="${hljsCssUrl}">
          <link rel="stylesheet" href="${cssFileUrl}">
        </head>
        <body class="${isDarkMode ? 'dark-mode' : ''}">
          <div class="last-page">
            ${hasCover ? '<div class="pagebreak"></div>' : ''}
            ${htmlContent}
            <div class="pdf-credit">
              Generated with <strong>${packageJson.displayName}</strong> <br>
              Version ${packageJson.version} — by <strong>${packageJson.publisher}</strong> <br>
              <a href="https://lien-vers-extension">See the extension</a>
            </div>
          </div>
        </body>
      </html>`;
      const contentTempPath = path.join(baseDir, '_content.html');
      fs.writeFileSync(contentTempPath, contentHtmlFull, 'utf-8');

      const pageContent = await browser.newPage();
      await pageContent.goto('file://' + contentTempPath, { waitUntil: 'networkidle0' });
      await pageContent.pdf({
        path: path.join(baseDir, '_content.pdf'),
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        margin: { top: '70px', bottom: '60px', left: '30px', right: '30px' },
        headerTemplate: `<div style="font-size:10px;width:100%;padding:5px 30px;color:#666;display:flex;align-items:center;justify-content:space-between;font-family:'Helvetica Neue', Arial, sans-serif;">
          ${headerLogo ? `<img src="${headerLogo}" style="height:5em;object-fit:contain;">` : ''}
          <div style="text-align:center;flex:1;"><span style="font-size:11px;font-weight:bold;">${headerTitle}</span></div>
          ${headerDate ? `<span style="font-size:10px;color:#888;">${headerDate}</span>` : ''}
        </div>`,
        footerTemplate: `<div style="font-size:10px;width:100%;text-align:center;color:#666;padding-top:5px;font-family:'Helvetica Neue', Arial, sans-serif;">
          Page <span class="pageNumber"></span> sur <span class="totalPages"></span>
        </div>`,
        pageRanges: hasCover ? '2-' : '1-',
      });

      await pageContent.close();
      fs.unlinkSync(contentTempPath);
      await browser.close();

      // Fusion PDF
      if (hasCover) {
        const merger = new PDFMerger();
        await merger.add(path.join(baseDir, '_cover.pdf'));
        await merger.add(path.join(baseDir, '_content.pdf'));
        await merger.save(path.join(baseDir, `${fileName}.pdf`));
        fs.unlinkSync(path.join(baseDir, '_cover.pdf'));
        fs.unlinkSync(path.join(baseDir, '_content.pdf'));
      } else {
        fs.renameSync(path.join(baseDir, '_content.pdf'), path.join(baseDir, `${fileName}.pdf`));
      }

      vscode.window.showInformationMessage(`✅ PDF created successfully : ${fileName}.pdf`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error generating PDF : ${err.message || err}`);
    }
  });

  context.subscriptions.push(disposable);
  context.subscriptions.push(toggleTheme);
}

export function deactivate(): void { }

/** === Extraction du bloc :::cover === */
function extractCoverData(markdown: string): { coverHtml: string; markdown: string } {
  const coverRegex = /^:::cover\s*([\s\S]*?):::/m;
  const match = markdown.match(coverRegex);
  if (!match) return { coverHtml: '', markdown };

  const coverBlock = match[1].trim();
  const lines = coverBlock.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const config: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) config[key.trim().toLowerCase()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
  }

  const title = config.title || 'Document';
  const subtitle = config.subtitle || '';
  const author = config.author || '';
  const date = config.date === 'auto'
    ? new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : (config.date || '');
  const background = config.background || '#ffffff';
  const textColor = config.textcolor || '#000000';
  const accentColor = config.accentcolor || '#2563eb';
  const align = config.align || 'center';
  const logo = config.logo ? `file:///${path.resolve(config.logo).replace(/\\/g, '/')}` : '';

  const coverHtml = `<div class="cover-page" style="align-items:${align};background:${background};color:${textColor};text-align:${align};">
    ${logo ? `<img src="${logo}" alt="Logo"/>` : ''}
    <h1 style="color:${accentColor};">${title}</h1>
    ${subtitle ? `<h2>${subtitle}</h2>` : ''}
    ${author ? `<p class="author">${author}</p>` : ''}
    ${date ? `<p class="date">${date}</p>` : ''}
  </div>`;

  return { coverHtml, markdown: markdown.replace(coverRegex, '').trim() };
}
