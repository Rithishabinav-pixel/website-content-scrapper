"use client";

import { useMemo, useState } from "react";
import UrlInputForm from "./UrlInputForm";
import ScrapeResults from "./ScrapeResults";
import styles from "./scraper.module.css";
import { isValidHttpUrl, normalizeUrlForComparison } from "@/lib/scraper/validateUrl";

const MAX_URLS = 10;

function computeFieldErrors(urls) {
  const seen = new Map();
  return urls.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return "URL is required.";
    if (!isValidHttpUrl(trimmed)) return "Enter a valid http:// or https:// URL.";
    const normalized = normalizeUrlForComparison(trimmed);
    if (seen.has(normalized)) return "This URL is a duplicate of another entry.";
    seen.set(normalized, true);
    return null;
  });
}

export default function ScraperApp() {
  const [urls, setUrls] = useState([""]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [results, setResults] = useState(null);

  const fieldErrors = useMemo(() => computeFieldErrors(urls), [urls]);
  const hasFieldErrors = fieldErrors.some(Boolean);

  function handleChange(index, value) {
    setUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  function handleAdd() {
    setUrls((prev) => (prev.length >= MAX_URLS ? prev : [...prev, ""]));
  }

  function handleRemove(index) {
    setUrls((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function applyEvent(event) {
    setResults((prev) => {
      if (!prev) return prev;
      return prev.map((r) => (r.index === event.index ? { ...r, ...event } : r));
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (hasFieldErrors || isSubmitting) return;

    const snapshotUrls = urls.map((u) => u.trim());
    setFormError(null);
    setIsSubmitting(true);
    setResults(snapshotUrls.map((url, index) => ({ index, url, status: "queued" })));

    try {
      const response = await fetch("/api/scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: snapshotUrls }),
      });

      if (!response.ok || !response.body) {
        let message = "The server rejected the request.";
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          // response body wasn't JSON — keep the generic message
        }
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.trim()) applyEvent(JSON.parse(line));
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) applyEvent(JSON.parse(buffer));
    } catch (err) {
      setFormError(err.message || "Something went wrong while scraping. Please try again.");
      setResults((prev) =>
        prev
          ? prev.map((r) =>
              r.status === "queued" || r.status === "processing"
                ? { ...r, status: "error", error: "The connection was interrupted before this URL finished processing." }
                : r
            )
          : prev
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Website Content Scraper</h1>
        <p>Enter up to 10 web page URLs. Each page&apos;s main content is extracted exactly as written and generated into its own downloadable DOCX file.</p>
      </div>

      <UrlInputForm
        urls={urls}
        fieldErrors={fieldErrors}
        showErrors={submitAttempted}
        disabled={isSubmitting}
        formError={formError}
        onChange={handleChange}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onSubmit={handleSubmit}
      />

      <ScrapeResults results={results} />
    </div>
  );
}
