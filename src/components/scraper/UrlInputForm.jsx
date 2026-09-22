"use client";

import styles from "./scraper.module.css";

const MAX_URLS = 10;

export default function UrlInputForm({ urls, fieldErrors, showErrors, disabled, formError, onChange, onAdd, onRemove, onSubmit }) {
  return (
    <form className={styles.card} onSubmit={onSubmit} noValidate>
      {urls.map((url, index) => {
        const error = showErrors ? fieldErrors[index] : null;
        return (
          <div className={styles.urlRow} key={index}>
            <label className={styles.urlRowLabel}>
              <span>URL {index + 1}</span>
              <input
                type="text"
                inputMode="url"
                className={`${styles.input} ${error ? styles.inputError : ""}`}
                placeholder="https://example.com/page"
                value={url}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(e) => onChange(index, e.target.value)}
              />
              {error ? <span className={styles.fieldError}>{error}</span> : null}
            </label>
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => onRemove(index)}
              disabled={disabled || urls.length <= 1}
              aria-label={`Remove URL ${index + 1}`}
              title="Remove this URL"
            >
              ×
            </button>
          </div>
        );
      })}

      <div className={styles.actionsRow}>
        <button type="button" className={styles.addButton} onClick={onAdd} disabled={disabled || urls.length >= MAX_URLS}>
          + Add URL
        </button>
        <span className={styles.urlCount}>
          {urls.length} / {MAX_URLS} URLs
        </span>
      </div>

      {formError ? <p className={styles.formError}>{formError}</p> : null}

      <div className={styles.submitRow}>
        <button type="submit" className={styles.submitButton} disabled={disabled}>
          {disabled ? "Scraping…" : "Scrape Content"}
        </button>
      </div>
    </form>
  );
}
