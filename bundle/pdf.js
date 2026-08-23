import { clampText } from "./core.js";

function ascii(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

function pdfEscape(value) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(value, width) {
  const words = ascii(value).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function addText(commands, text, x, y, size = 10, font = "F1") {
  commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
}

export function createCheatSheetPdf(lesson) {
  const commands = [];
  let y = 785;
  addText(commands, "LEARNTUBE AI  /  ONE-PAGE CHEAT SHEET", 48, y, 9, "F2");
  y -= 38;
  for (const line of wrap(clampText(lesson.title, 120), 42).slice(0, 2)) {
    addText(commands, line, 48, y, 22, "F2");
    y -= 26;
  }
  y -= 4;
  addText(commands, `${lesson.sourceLabel || "Lesson"}  |  ${new Date(lesson.createdAt).toLocaleDateString()}`, 48, y, 8, "F1");
  y -= 24;

  const section = (heading, values, numbered = false) => {
    if (!values?.length || y < 90) return;
    addText(commands, heading.toUpperCase(), 48, y, 10, "F2");
    y -= 16;
    values.forEach((value, index) => {
      if (y < 74) return;
      const prefix = numbered ? `${index + 1}. ` : "- ";
      for (const [lineIndex, line] of wrap(`${prefix}${value}`, 86).slice(0, 3).entries()) {
        addText(commands, lineIndex ? `  ${line}` : line, 55, y, 9, "F1");
        y -= 12;
      }
      y -= 2;
    });
    y -= 8;
  };

  section("In one breath", [lesson.cheatSheet?.headline || lesson.summary]);
  section("Essentials", lesson.cheatSheet?.essentials);
  section("Workflow", lesson.cheatSheet?.workflow, true);
  section("Watch-outs", lesson.cheatSheet?.traps);

  commands.push("0.094 0.2 0.169 RG 1 w 48 46 m 547 46 l S");
  addText(commands, "Generated from the lesson source. Verify important details against the original.", 48, 31, 7, "F1");

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([new TextEncoder().encode(output)], { type: "application/pdf" });
}

export function downloadCheatSheet(lesson) {
  const blob = createCheatSheetPdf(lesson);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "learntube-cheat-sheet";
  link.href = url;
  link.download = `${filename}-cheat-sheet.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
