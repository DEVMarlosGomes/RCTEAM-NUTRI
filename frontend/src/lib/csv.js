export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) =>
    String(header || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  );
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] ?? "";
    });
    return item;
  });
}

export async function loadPublicCsv(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}`);
  }

  const text = await response.text();
  return parseCsv(text);
}
