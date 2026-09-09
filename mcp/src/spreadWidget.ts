import { McpServer } from "@modelcontextprotocol/server";

export const ARCANA_SPREAD_WIDGET_URI = "ui://arcana/spread/v1.html";

const SPREAD_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: transparent;
      --text: #1f2937;
      --muted: #6b7280;
      --surface: #ffffff;
      --surface-2: #f3f4f6;
      --border: rgba(17, 24, 39, 0.14);
      --shadow: 0 10px 30px rgba(17, 24, 39, 0.12);
      --tooltip-bg: #111827;
      --tooltip-text: #f9fafb;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --text: #f3f4f6;
        --muted: #a1a1aa;
        --surface: #18181b;
        --surface-2: #27272a;
        --border: rgba(255, 255, 255, 0.14);
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
        --tooltip-bg: #f4f4f5;
        --tooltip-text: #18181b;
      }
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body { min-width: 0; }

    .spread-shell {
      width: 100%;
      padding: 14px;
    }

    .spread-header {
      display: grid;
      gap: 4px;
      margin-bottom: 14px;
      text-align: center;
    }

    .spread-title {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
      font-weight: 700;
    }

    .spread-question {
      margin: 0 auto;
      max-width: 70ch;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .spread-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(148px, 196px));
      justify-content: center;
      align-items: start;
      gap: 16px;
      width: 100%;
    }

    .placement {
      min-width: 0;
      display: grid;
      gap: 8px;
      justify-items: stretch;
    }

    .position-label {
      position: relative;
      justify-self: center;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 100%;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text);
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      text-align: center;
      cursor: help;
      outline: none;
    }

    .position-label:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }

    .position-hint {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }

    .position-tooltip {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      z-index: 20;
      width: max-content;
      max-width: min(260px, 78vw);
      padding: 7px 9px;
      border-radius: 8px;
      background: var(--tooltip-bg);
      color: var(--tooltip-text);
      box-shadow: var(--shadow);
      font-size: 11px;
      line-height: 1.35;
      font-weight: 500;
      text-align: left;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .position-label:hover .position-tooltip,
    .position-label:focus .position-tooltip,
    .position-label:focus-within .position-tooltip {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    .card-frame {
      position: relative;
      width: 100%;
      aspect-ratio: 2 / 3;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
      box-shadow: var(--shadow);
    }

    .card-art {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform-origin: center;
    }

    .card-art.reversed { transform: rotate(180deg); }

    .card-missing {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      padding: 16px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    .card-caption {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: baseline;
      gap: 5px;
      min-height: 30px;
      padding: 0 4px;
      text-align: center;
    }

    .card-name {
      font-size: 12px;
      line-height: 1.3;
      font-weight: 650;
    }

    .reversed-badge {
      padding: 1px 5px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 9px;
      line-height: 1.4;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .waiting {
      padding: 28px 16px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 520px) {
      .spread-shell { padding: 12px 8px; }
      .spread-grid {
        grid-template-columns: minmax(0, 220px);
        gap: 18px;
      }
      .spread-question { max-width: 34ch; }
    }
  </style>
</head>
<body>
  <main id="root" class="waiting">Preparing spread…</main>
  <script>
    (function () {
      var root = document.getElementById("root");

      function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
      }

      function renderToolResult(toolResult) {
        var result = toolResult && toolResult.structuredContent && toolResult.structuredContent.result;
        if (!result || !Array.isArray(result.placements)) return;

        var images = Array.isArray(toolResult.content)
          ? toolResult.content.filter(function (part) { return part && part.type === "image"; })
          : [];

        var shell = element("section", "spread-shell");
        var header = element("header", "spread-header");
        header.appendChild(element("h2", "spread-title", result.deckName + " · " + result.spreadName));
        if (result.question) header.appendChild(element("p", "spread-question", result.question));
        shell.appendChild(header);

        var grid = element("div", "spread-grid");

        result.placements.forEach(function (placement, index) {
          var item = element("article", "placement");

          var label = element("div", "position-label");
          label.tabIndex = 0;
          label.appendChild(element("span", "", placement.position));
          if (placement.positionPrompt) {
            label.appendChild(element("span", "position-hint", "?"));
            var tooltip = element("div", "position-tooltip", placement.positionPrompt);
            tooltip.setAttribute("role", "tooltip");
            label.appendChild(tooltip);
          }
          item.appendChild(label);

          var frame = element("div", "card-frame");
          var image = images[index];
          if (image && image.data && image.mimeType) {
            var img = document.createElement("img");
            img.className = "card-art" + (placement.reversed ? " reversed" : "");
            img.alt = placement.cardName + (placement.reversed ? ", reversed" : "");
            img.src = "data:" + image.mimeType + ";base64," + image.data;
            frame.appendChild(img);
          } else {
            frame.appendChild(element("div", "card-missing", "Card art unavailable"));
          }
          item.appendChild(frame);

          var caption = element("div", "card-caption");
          caption.appendChild(element("span", "card-name", placement.cardName));
          if (placement.reversed) caption.appendChild(element("span", "reversed-badge", "reversed"));
          item.appendChild(caption);

          grid.appendChild(item);
        });

        shell.appendChild(grid);
        root.replaceWith(shell);
        root = shell;

        if (window.openai && typeof window.openai.notifyIntrinsicHeight === "function") {
          requestAnimationFrame(function () { window.openai.notifyIntrinsicHeight(); });
        }
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-result") renderToolResult(message.params);
      }, { passive: true });
    })();
  </script>
</body>
</html>`;

export function registerArcanaSpreadWidget(server: McpServer): void {
  server.registerResource("arcana-spread-widget", ARCANA_SPREAD_WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: ARCANA_SPREAD_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: SPREAD_WIDGET_HTML,
        _meta: {
          ui: { prefersBorder: true },
          "openai/widgetDescription": "A responsive visual Arcana spread with labeled positions and hover/focus explanations.",
          "openai/widgetPrefersBorder": true,
        },
      },
    ],
  }));
}
