import React from "react";

// Markdown minimo para respostas dos agentes: titulos, listas, tabelas, separadores e negrito.
const STATUS_COLORS = {
  adequado: "text-emerald-300",
  elevado: "text-red-300",
  reduzido: "text-amber-300",
  "limítrofe": "text-yellow-200",
  limitrofe: "text-yellow-200",
};

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

const splitRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isTableSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function renderTable(rows, key) {
  const [header, ...body] = rows;
  return (
    <div key={key} className="overflow-x-auto my-3 rounded-lg border border-white/10">
      <table className="w-full text-xs">
        <thead className="bg-white/5">
          <tr>{header.map((h, i) => <th key={i} className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wider">{inline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-white/5">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2 text-gray-200 ${STATUS_COLORS[cell.toLowerCase()] || ""}`}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarkdownView({ content }) {
  if (!content) return null;
  const lines = content.split("\n");
  const out = [];
  let list = null;
  let table = null;
  const flushList = (k) => { if (list) { out.push(<ul key={`ul-${k}`} className="pl-5 space-y-1 my-2 list-disc">{list}</ul>); list = null; } };
  const flushTable = (k) => { if (table) { out.push(renderTable(table, `tb-${k}`)); table = null; } };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      flushList(i);
      if (isTableSeparator(trimmed)) return;
      table = table || [];
      table.push(splitRow(trimmed));
      return;
    }
    flushTable(i);
    if (!trimmed) { flushList(i); return; }
    if (/^-{3,}$/.test(trimmed)) { flushList(i); out.push(<hr key={i} className="border-white/10 my-4" />); return; }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList(i);
      const level = heading[1].length;
      const cls = level === 1
        ? "text-cyan-300 font-display font-bold text-sm uppercase tracking-wider mt-5 mb-1"
        : level === 2 ? "text-white font-semibold text-sm mt-4" : "text-gray-300 font-semibold text-xs uppercase tracking-wider mt-3";
      out.push(<div key={i} className={cls}>{inline(heading[2])}</div>);
      return;
    }
    const bullet = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      list = list || [];
      list.push(<li key={i} className="text-sm text-gray-200 leading-relaxed">{inline(bullet[1])}</li>);
      return;
    }
    flushList(i);
    out.push(<p key={i} className="text-sm text-gray-200 leading-relaxed my-1.5">{inline(trimmed)}</p>);
  });
  flushList("end");
  flushTable("end");
  return <div>{out}</div>;
}
