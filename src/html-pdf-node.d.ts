declare module 'html-pdf-node' {
  interface Options {
    format?: string;
    landscape?: boolean;
    margin?: { top?: string; bottom?: string; left?: string; right?: string };
  }

  interface File {
    content?: string;
    url?: string;
    path?: string;
  }

  function generatePdf(file: File, options?: Options): Promise<Buffer>;

  export { generatePdf };
}
