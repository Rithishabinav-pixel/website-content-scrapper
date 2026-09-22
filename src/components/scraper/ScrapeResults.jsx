"use client";

import { useState } from "react";
import JSZip from "jszip";
import styles from "./scraper.module.css";
import ScrapeProgress from "./ScrapeProgress";
import { downloadDocx, downloadBlob, base64ToBytes } from "@/lib/scraper/clientDownload";

const STATUS_ICON = {
  queued: "⏳",
  processing: "⏳",
  success: "✓",
  error: "✗",
};

const STATUS_LABEL = {
  queued: "Queued",
  processing: "Processing…",
  success: "Completed",
};

export default function ScrapeResults({ results }) {
  const [isZipping, setIsZipping] = useState(false);

  if (!results || results.length === 0) {
    return (
      <section className={styles.resultsSection}>
        <p className={styles.emptyState}>Enter up to 10 URLs above and click &ldquo;Scrape Content&rdquo; to generate DOCX documents.</p>
      </section>
    );
  }

  const successfulResults = results.filter((r) => r.status === "success");

  async function handleDownloadAll() {
    if (successfulResults.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set();
      for (const result of successfulResults) {
        let name = result.filename;
        let counter = 2;
        while (usedNames.has(name)) {
          name = result.filename.replace(/\.docx$/, `-${counter}.docx`);
          counter += 1;
        }
        usedNames.add(name);
        zip.file(name, base64ToBytes(result.docxBase64));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "scraped-documents.zip");
    } finally {
      setIsZipping(false);
    }
  }

  return (
    <section className={styles.resultsSection}>
      <div className={styles.resultsHeader}>
        <h2>Scraping Results</h2>
        <ScrapeProgress results={results} />
      </div>

      {successfulResults.length > 1 ? (
        <button className={styles.downloadAllButton} onClick={handleDownloadAll} disabled={isZipping} type="button">
          {isZipping ? "Preparing ZIP…" : `Download All (${successfulResults.length})`}
        </button>
      ) : null}

      <div className={styles.resultList}>
        {results.map((result) => (
          <div className={styles.resultRow} key={result.index}>
            <span className={styles.statusIcon} data-status={result.status} aria-hidden="true">
              {STATUS_ICON[result.status] || "•"}
            </span>
            <div className={styles.resultInfo}>
              <span className={styles.resultUrl} title={result.url}>
                {result.url}
              </span>
              {result.status === "error" ? (
                <span className={styles.resultMeta} data-tone="error">
                  {result.error || "This URL could not be processed."}
                </span>
              ) : (
                <span className={styles.resultMeta}>{STATUS_LABEL[result.status] || result.status}</span>
              )}
            </div>
            {result.status === "success" ? (
              <button type="button" className={styles.downloadButton} onClick={() => downloadDocx(result.docxBase64, result.filename)}>
                Download {result.filename}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
