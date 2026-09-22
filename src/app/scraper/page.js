import ScraperApp from "@/components/scraper/ScraperApp";

export const metadata = {
  title: "Website Content Scraper",
  description: "Scrape the main content of up to 10 web pages and download each as a DOCX document.",
};

export default function ScraperPage() {
  return <ScraperApp />;
}
