import { McpServer } from "@modelcontextprotocol/server";

export const ARCANA_SPREAD_WIDGET_URI = "ui://arcana/spread/v2.html";

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

    .living-frame { position: relative; width: min(100%, 900px); height: clamp(380px, 62vw, 560px); margin: 0 auto; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: #0d0c0b; box-shadow: var(--shadow); }
    .living-canvas { display: block; width: 100%; height: 100%; touch-action: manipulation; cursor: crosshair; }
    .living-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 7px; margin: 0 0 10px; color: var(--muted); font-size: 10px; line-height: 1.3; text-transform: uppercase; letter-spacing: .06em; font-weight: 750; }
    .living-pill { padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); }
    .living-detail { width: min(100%, 900px); min-height: 54px; margin: 10px auto 0; padding: 9px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--muted); font-size: 11px; line-height: 1.45; }
    .living-detail strong { color: var(--text); }

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
      var disposeLivingScene = null;

      function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
      }

      function renderLivingSpread(result) {
        if (disposeLivingScene) { disposeLivingScene(); disposeLivingScene = null; }
        var shell = element("section", "spread-shell");
        var header = element("header", "spread-header");
        header.appendChild(element("h2", "spread-title", result.deckName + " · " + result.spreadName));
        if (result.question) header.appendChild(element("p", "spread-question", result.question));
        shell.appendChild(header);
        var meta = element("div", "living-meta");
        meta.appendChild(element("span", "living-pill", "Living Spread"));
        if (result.layout.packLabel) meta.appendChild(element("span", "living-pill", result.layout.packLabel));
        meta.appendChild(element("span", "", "Hover the column · click a layer to hold its meaning"));
        shell.appendChild(meta);
        var frame = element("div", "living-frame");
        var canvas = element("canvas", "living-canvas");
        canvas.setAttribute("aria-label", result.spreadName + " Living Spread");
        frame.appendChild(canvas); shell.appendChild(frame);
        var detail = element("div", "living-detail");
        detail.innerHTML = "<strong>Living Spread:</strong> each dealt card is one layer of the same visual system.";
        shell.appendChild(detail);
        root.replaceWith(shell); root = shell;
        if (result.layout.format === "generative-arcana/deep-time-core-sample@1") disposeLivingScene = mountCoreSample(canvas, detail, result);
        else frame.replaceChildren(element("div", "card-missing", "Unsupported Living Spread format: " + String(result.layout.format || "unknown")));
      }

      function mountCoreSample(canvas, detail, result) {
        var ctx = canvas.getContext("2d"), ps = result.placements || [], hover = -1, selected = -1, raf = 0, dead = false;
        var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)"), start = performance.now(), w = 1, h = 1, dpr = 1;
        var families = { vents:[198,78,34], strata:[159,111,67], grains:[194,169,112], faults:[76,91,98], major:[205,168,91] };
        var stations = { melt:[174,54,24], crystallization:[124,168,195], uplift:[203,184,135], weathering:[153,140,111], transport:[108,144,159], deposition:[192,146,88], burial:[69,58,50], metamorphism:[130,72,60] };
        function hash(v){ var x=2166136261>>>0; for(var i=0;i<v.length;i++){x^=v.charCodeAt(i);x=Math.imul(x,16777619);} return x>>>0; }
        function frac(v){ return v-Math.floor(v); }
        function mix(a,b,f){ return [Math.round(a[0]+(b[0]-a[0])*f),Math.round(a[1]+(b[1]-a[1])*f),Math.round(a[2]+(b[2]-a[2])*f)]; }
        function family(p){ return p.visual.family.kind === "major" ? "major" : (p.visual.family.slug || "major"); }
        function bandY(i){ return (ps.length-1-i)*(h/Math.max(1,ps.length)); }
        function resize(){ var r=canvas.getBoundingClientRect(); dpr=Math.min(window.devicePixelRatio||1,2); w=Math.max(1,Math.round(r.width)); h=Math.max(1,Math.round(r.height)); canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); draw(0); }
        function at(clientY){ var r=canvas.getBoundingClientRect(), y=Math.max(0,Math.min(.9999,(clientY-r.top)/Math.max(1,r.height))); return ps.length-1-Math.floor(y*ps.length); }
        function line(x1,y1,x2,y2,color,lw){ ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=lw||1;ctx.stroke(); }
        function dot(x,y,r,color){ ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill(); }
        function draw(t){
          ctx.fillStyle="#0d0c0b";ctx.fillRect(0,0,w,h); if(!ps.length)return; var bh=h/ps.length;
          ps.forEach(function(p){
            var y=bandY(p.index), fam=family(p), base=families[fam]||families.major, st=stations[p.visual.stationSlug]||[128,128,128], c=mix(base,st,.24), lift=hover===p.index?24:0;
            ctx.fillStyle="rgb("+Math.min(255,c[0]+lift)+","+Math.min(255,c[1]+lift)+","+Math.min(255,c[2]+lift)+")";ctx.fillRect(0,y,w,bh+1);
            var seed=hash(p.cardSlug), moving=!(reduced&&reduced.matches);
            if(fam==="strata") for(var j=1;j<6;j++) line(0,y+bh*j/6,w,y+bh*j/6+Math.sin(t*.2+j+seed)*2,"rgba(246,226,190,.34)",1);
            if(fam==="grains") for(var g=0;g<30;g++){var u=frac(Math.sin(seed*.0003+g*31.7)*19341.7+(moving?t*.012:0));dot(u*w,y+frac(Math.sin(seed+g*17.1)*77821)*bh,1+(g%3)*.4,"rgba(252,237,197,.38)");}
            if(p.reversed) for(var x=-bh;x<w+bh;x+=Math.max(10,Math.min(w,h)*.025)) line(x,y+bh,x+bh,y,"rgba(20,18,17,.32)",1);
            if(hover===p.index){ctx.strokeStyle="rgba(248,238,209,.88)";ctx.lineWidth=2;ctx.strokeRect(2,y+2,w-4,bh-4);}
          });
          ps.forEach(function(p){ var fam=family(p), seed=hash(p.cardSlug), bh=h/ps.length, y=bandY(p.index)+bh*.5;
            if(fam==="faults"){var x=w*(.3+(seed%35)/100)+(reduced&&reduced.matches?0:Math.sin(t*.4+seed)*4);line(x-25,0,x+45,h,"rgba(151,227,210,.72)",3);line(x-17,0,x+53,h,"rgba(12,15,17,.55)",6);}
            if(fam==="vents") for(var k=0;k<24;k++){var f=k/23, yy=y-f*(y+h*.05), xx=w*(.25+(seed%40)/100)+Math.sin(f*10+t*.55+seed)*w*(.006+f*.018);dot(xx,yy,2+f*7,"rgba(255,"+Math.round(130+f*80)+",70,"+(.15+f*.25)+")");}
            if(p.arcana==="major"){var pulse=(reduced&&reduced.matches)?0:(Math.sin(t+seed)+1)/2;ctx.beginPath();ctx.arc(w*.5,y,18+pulse*8,0,Math.PI*2);ctx.strokeStyle="rgba(255,222,142,.65)";ctx.lineWidth=2;ctx.stroke();}
          });
          ctx.font=Math.max(10,Math.min(14,bh*.11))+"px ui-monospace,monospace";
          ps.forEach(function(p){var y=bandY(p.index);ctx.fillStyle="rgba(255,246,222,.82)";ctx.textBaseline="top";ctx.textAlign="left";ctx.fillText(String(p.position).toUpperCase(),10,y+9);ctx.textBaseline="bottom";ctx.textAlign="right";ctx.fillStyle="rgba(255,246,222,.70)";ctx.fillText(p.cardName+(p.reversed?" · REVERSED":""),w-10,y+bh-9);});
        }
        function show(i,locked){var p=ps[i]; if(!p)return; detail.textContent="";var b=document.createElement("strong");b.textContent=(locked?"Selected · ":"")+p.position+" — "+p.cardName+(p.reversed?" (Reversed)":"");detail.appendChild(b);detail.appendChild(document.createTextNode(" · "+p.meaning));}
        function move(e){hover=at(e.clientY);if(selected<0)show(hover,false);} function leave(){hover=-1;} function click(e){var i=at(e.clientY);selected=selected===i?-1:i;if(selected>=0)show(selected,true);}
        function frame(now){if(dead)return;draw(reduced&&reduced.matches?0:(now-start)/1000);if(!(reduced&&reduced.matches))raf=requestAnimationFrame(frame);}
        canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerleave",leave);canvas.addEventListener("click",click);var ro=new ResizeObserver(resize);ro.observe(canvas);resize();raf=requestAnimationFrame(frame);
        return function(){dead=true;cancelAnimationFrame(raf);ro.disconnect();canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerleave",leave);canvas.removeEventListener("click",click);};
      }

      function renderToolResult(toolResult) {
        var result = toolResult && toolResult.structuredContent && toolResult.structuredContent.result;
        if (!result || !Array.isArray(result.placements)) return;
        if (result.layout && result.layout.kind === "living-spread") { renderLivingSpread(result); return; }
        if (disposeLivingScene) { disposeLivingScene(); disposeLivingScene = null; }

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
            label.setAttribute("aria-label", placement.position + ": " + placement.positionPrompt);
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

      }

      var pendingRequests = new Map();
      var nextRequestId = 1;
      var initialized = false;

      function post(message) {
        window.parent.postMessage(message, "*");
      }

      function request(method, params) {
        var id = nextRequestId++;
        return new Promise(function (resolve, reject) {
          pendingRequests.set(id, { resolve: resolve, reject: reject });
          post({ jsonrpc: "2.0", id: id, method: method, params: params });
        });
      }

      function notify(method, params) {
        post({ jsonrpc: "2.0", method: method, params: params || {} });
      }

      function renderChatGptCompatibilityOutput() {
        var bridge = window.openai;
        if (!bridge) return false;

        // ChatGPT keeps the full MCP result envelope in widget-only metadata.
        // Prefer it when available so image content reaches the widget too.
        var metadata = bridge.toolResponseMetadata;
        var fullResult = metadata && metadata.mcp_tool_result;
        if (fullResult && fullResult.structuredContent) {
          renderToolResult(fullResult);
          return true;
        }

        if (!bridge.toolOutput) return false;

        // window.openai.toolOutput is the tool's structuredContent.
        renderToolResult({ structuredContent: bridge.toolOutput, content: [] });
        return true;
      }

      function reportSize() {
        requestAnimationFrame(function () {
          notify("ui/notifications/size-changed", {
            height: Math.ceil(document.documentElement.scrollHeight),
          });

          if (window.openai && typeof window.openai.notifyIntrinsicHeight === "function") {
            window.openai.notifyIntrinsicHeight();
          }
        });
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;

        if (message.id !== undefined && pendingRequests.has(message.id)) {
          var pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (message.error) pending.reject(message.error);
          else pending.resolve(message.result);
          return;
        }

        if (message.method === "ui/notifications/tool-result") {
          renderToolResult(message.params);
          reportSize();
        }
      }, { passive: true });

      request("ui/initialize", {
        appInfo: { name: "Generative Arcana Spread", version: "2.1.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: "2026-01-26",
      }).then(function () {
        initialized = true;
        notify("ui/notifications/initialized", {});

        // Some ChatGPT surfaces materialize the result on the compatibility
        // bridge as well. If it is already there, render it rather than wait.
        if (renderChatGptCompatibilityOutput()) reportSize();
      }).catch(function (error) {
        root.textContent = "Unable to initialize spread.";
        root.title = error && error.message
          ? error.message
          : String(error || "Unknown initialization error");
      });

      setTimeout(function () {
        if (!initialized && root && root.classList && root.classList.contains("waiting")) {
          root.textContent = "Still waiting for the host to initialize this spread…";
        }
      }, 8000);
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
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          "openai/widgetDescription": "A responsive Arcana renderer for static card layouts and interactive Living Spreads.",
          "openai/widgetPrefersBorder": true,
        },
      },
    ],
  }));
}
