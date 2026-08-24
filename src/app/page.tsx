import { GoogleMapsInput } from "@/components/import/GoogleMapsInput";

function CompassMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="m30.8 16.4-4.2 10.2-10.2 4.2 4.2-10.2Z"/><circle cx="24" cy="24" r="2.2"/></svg>;
}

export default function Home() {
  return (
    <main>
      <nav className="nav">
        <a href="#top" className="wordmark"><CompassMark /><span>TravelTrace</span></a>
        <div className="phase-chip"><i /> Building Phase 1 · Importer</div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-art" aria-hidden="true">
          <span className="orbit orbit-one" /><span className="orbit orbit-two" />
          <span className="pin pin-one">H</span><span className="pin pin-two">T</span><span className="pin pin-three">B</span>
          <svg viewBox="0 0 520 190"><path d="M20 141C116 32 196 208 286 90S432 33 500 59"/><path className="route-progress" d="M20 141C116 32 196 208 286 90S432 33 500 59"/></svg>
        </div>
        <p className="overline"><span /> Your saved places, set in motion</p>
        <h1>A link is all it takes<br />to begin your <em>story.</em></h1>
        <p className="hero-copy">Turn a public Google Maps saved list into clean, portable journey data—ready for the animated travel story we’ll build next.</p>
        <div className="trust-row"><span>✓ No Google login</span><span>✓ No API key</span><span>✓ No data stored</span></div>
      </section>

      <GoogleMapsInput />

      <section className="how-it-works" aria-labelledby="how-heading">
        <p className="overline"><span /> Under the hood</p>
        <h2 id="how-heading">Small surface. Strong boundaries.</h2>
        <div className="principles">
          <article><b>01</b><h3>Validate</h3><p>Only approved Google Maps hosts are accepted, including every redirect target.</p></article>
          <article><b>02</b><h3>Extract</h3><p>The undocumented Google response is contained inside one replaceable importer.</p></article>
          <article><b>03</b><h3>Normalize</h3><p>Every usable result becomes a typed TravelPlace with explicit ordering.</p></article>
        </div>
      </section>

      <footer className="site-footer"><span>TravelTrace</span><p>Private by default · Ephemeral by design</p></footer>
    </main>
  );
}
