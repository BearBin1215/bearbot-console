import type { WebContents } from 'electron';

/**
 * 在开发者工具打开时注入自定义等宽字体样式。
 * 监听 devtools-opened 事件，向 devToolsWebContents 注入 CSS 与 MutationObserver，
 * 将开发者工具的等宽字体改为 Consolas / Jetbrains Mono。
 */
export function setupDevToolsFont(webContents: WebContents): void {
  webContents.on('devtools-opened', () => {
    const css = `
      :root {
        --sys-color-base: var(--ref-palette-neutral100);
        --source-code-font-family: Consolas, Jetbrains Mono !important;
        --source-code-font-size: 12px;
        --monospace-font-family: Consolas, Jetbrains Mono !important;
        --monospace-font-size: 12px;
        --default-font-family: system-ui, sans-serif;
        --default-font-size: 12px;
        --ref-palette-neutral99: #ffffffff;
      }
      .theme-with-dark-background {
        --sys-color-base: var(--ref-palette-secondary25);
      }
      body {
        --default-font-family: system-ui,sans-serif;
      }
    `;
    const devTools = webContents.devToolsWebContents;
    if (devTools) {
      devTools.executeJavaScript(`
        const overriddenStyle = document.createElement('style');
        overriddenStyle.innerHTML = '${css.replaceAll('\n', ' ')}';
        document.body.append(overriddenStyle);
        document.querySelectorAll('.platform-windows').forEach(el => el.classList.remove('platform-windows'));
        addStyleToAutoComplete();
        const observer = new MutationObserver((mutationList, observer) => {
          for (const mutation of mutationList) {
            if (mutation.type === 'childList') {
              for (let i = 0; i < mutation.addedNodes.length; i++) {
                const item = mutation.addedNodes[i];
                if (item.classList.contains('editor-tooltip-host')) {
                  addStyleToAutoComplete();
                }
              }
            }
          }
        });
        observer.observe(document.body, {childList: true});
        function addStyleToAutoComplete() {
          document.querySelectorAll('.editor-tooltip-host').forEach(element => {
            if (element.shadowRoot.querySelectorAll('[data-key="overridden-dev-tools-font"]').length === 0) {
              const overriddenStyle = document.createElement('style');
              overriddenStyle.setAttribute('data-key', 'overridden-dev-tools-font');
              overriddenStyle.innerHTML = '.cm-tooltip-autocomplete ul[role=listbox] {font-family: Consolas, Jetbrains Mono !important;}';
              element.shadowRoot.append(overriddenStyle);
            }
          });
        }
      `);
    }
  });
}
