import { escapeHtml } from "../jsx/escape";

export interface ScriptDescriptor {
  src: string;
  nonce?: string;
}

function buildScriptTag(descriptor: ScriptDescriptor): string {
  const escapedSrc = escapeHtml(descriptor.src);
  const nonceAttr = descriptor.nonce
    ? ` nonce="${escapeHtml(descriptor.nonce)}"`
    : "";
  return `<script type="module" src="${escapedSrc}"` + `${nonceAttr}></script>`;
}

export function injectScripts(
  html: string,
  scripts: ScriptDescriptor[],
): string {
  if (scripts.length === 0) return html;

  const tags = scripts.map(buildScriptTag).join("\n");
  const bodyCloseIndex = html.lastIndexOf("</body>");

  if (bodyCloseIndex === -1) {
    return `${html}\n${tags}`;
  }

  return `${html.slice(0, bodyCloseIndex)}${tags}\n${html.slice(bodyCloseIndex)}`;
}
