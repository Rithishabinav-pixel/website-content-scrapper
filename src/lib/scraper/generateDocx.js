import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat, convertInchesToTwip } from "docx";
import { ScraperError, ErrorCodes } from "./errors";

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const NUMBERING_REFERENCE = "scraper-ordered-list";
const NUMBERING_CONFIG = {
  config: [
    {
      reference: NUMBERING_REFERENCE,
      levels: [0, 1, 2, 3, 4, 5].map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        style: {
          paragraph: {
            indent: { left: convertInchesToTwip(0.5 * (level + 1)), hanging: convertInchesToTwip(0.25) },
          },
        },
      })),
    },
  ],
};

function isHyperlinkTarget(href) {
  return typeof href === "string" && /^(https?:|mailto:)/i.test(href);
}

function buildRunChildren(runs) {
  const children = [];
  for (const run of runs) {
    if (!run || typeof run.text !== "string" || run.text.length === 0) continue;

    if (run.text === "\n") {
      children.push(new TextRun({ text: "", break: 1 }));
      continue;
    }

    const baseProps = {
      text: run.text,
      bold: !!run.bold,
      italics: !!run.italic,
      strike: !!run.strike,
      font: run.code ? "Consolas" : undefined,
    };

    if (run.link && isHyperlinkTarget(run.link)) {
      children.push(
        new ExternalHyperlink({
          link: run.link,
          children: [new TextRun({ ...baseProps, style: "Hyperlink", underline: {}, color: "0563C1" })],
        })
      );
    } else {
      children.push(new TextRun({ ...baseProps, underline: run.underline ? {} : undefined }));
    }
  }
  return children;
}

function buildParagraph(runs, options = {}) {
  return new Paragraph({ children: buildRunChildren(runs), ...options });
}

function mergeIndent(options, extraTwips) {
  const currentLeft = options.indent?.left || 0;
  return { ...options, indent: { ...(options.indent || {}), left: currentLeft + extraTwips } };
}

function buildTable(tableBlock) {
  const rows = tableBlock.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [buildParagraph(cell.runs.length ? cell.runs : [{ text: "" }])],
              shading: cell.isHeader ? { fill: "EEEEEE" } : undefined,
            })
        ),
      })
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function buildListNodes(listBlock, extraOptions, level) {
  const nodes = [];
  for (const item of listBlock.items) {
    const paragraphOptions = { ...extraOptions };
    if (listBlock.ordered) {
      paragraphOptions.numbering = { reference: NUMBERING_REFERENCE, level: Math.min(level, 5) };
    } else {
      paragraphOptions.bullet = { level: Math.min(level, 5) };
    }
    nodes.push(buildParagraph(item.runs.length ? item.runs : [{ text: "" }], paragraphOptions));
    for (const nestedList of item.nested) {
      nodes.push(...buildListNodes(nestedList, extraOptions, level + 1));
    }
  }
  return nodes;
}

function blockToNodes(block, extraOptions = {}) {
  switch (block.type) {
    case "heading":
      return [buildParagraph(block.runs, { heading: HEADING_LEVELS[block.level] || HeadingLevel.HEADING_6, ...extraOptions })];
    case "paragraph":
      return [buildParagraph(block.runs, { spacing: { after: 160 }, ...extraOptions })];
    case "divider":
      return [
        new Paragraph({
          border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
          ...extraOptions,
        }),
      ];
    case "blockquote": {
      const nestedOptions = mergeIndent(extraOptions, convertInchesToTwip(0.4));
      const nodes = [];
      for (const inner of block.blocks) {
        nodes.push(...blockToNodes(inner, nestedOptions));
      }
      return nodes;
    }
    case "list":
      return buildListNodes(block, extraOptions, 0);
    case "table":
      return [buildTable(block)];
    default:
      return [];
  }
}

/**
 * Builds a .docx file (as a Buffer) from the block model produced by
 * extractMainContent.js. Headings stay headings, lists stay lists, and
 * every text run carries over exactly the characters that were scraped.
 */
export async function generateDocxBuffer({ title, sourceUrl, blocks }) {
  const children = [];
  for (const block of blocks) {
    children.push(...blockToNodes(block));
  }

  if (children.length === 0) {
    throw new ScraperError(ErrorCodes.DOCX_GENERATION_FAILED, "No content was available to generate a document.");
  }

  try {
    const doc = new Document({
      creator: "Website Content Scraper",
      title: title || undefined,
      description: sourceUrl ? `Scraped from ${sourceUrl}` : undefined,
      numbering: NUMBERING_CONFIG,
      sections: [{ properties: {}, children }],
    });
    return await Packer.toBuffer(doc);
  } catch (err) {
    throw new ScraperError(ErrorCodes.DOCX_GENERATION_FAILED, `Failed to generate the DOCX document: ${err.message}`);
  }
}
