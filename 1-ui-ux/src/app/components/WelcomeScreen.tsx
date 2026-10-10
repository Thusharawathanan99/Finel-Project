import { Heart, ArrowUpRight, Activity, FileText, Users, ShieldCheck, Sparkles, Check, ScanLine, Utensils, Bell, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps { onContinue: () => void; }

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  return (
    <div className="care-landing care-reference" id="home">
      <header className="care-landing-nav">
        <div className="care-brand"><span className="care-brand-mark"><Heart aria-hidden="true" /></span>CareConnect<span className="care-brand-dot">.</span></div>
        <nav className="care-landing-links" aria-label="Page sections"><a href="#home">Home</a><a href="#features">Features</a><a href="#how">How it works</a></nav>
        <button onClick={onContinue} className="care-nav-cta">Sign in <ArrowUpRight size={16} aria-hidden="true" /></button>
      </header>
      <main>
        <section className="care-hero">
          <div className="care-hero-copy">
            <span className="care-eyebrow"><Sparkles size={13} /> AI-POWERED ELDERLY CARE</span>
            <h1>Caring today.<br />For a brighter<br /><span>tomorrow.</span></h1>
            <p className="care-hero-description">Thoughtful technology for healthier, happier days. Bring prescriptions, daily wellbeing, and your care team together in one caring place.</p>
            <div className="care-hero-actions"><button onClick={onContinue} className="care-primary-cta">Get started <ArrowUpRight size={20} aria-hidden="true" /></button><a href="#how" className="care-secondary-cta">Explore the care journey <ArrowRight size={17} /></a></div>
            <div className="care-hero-benefits"><span><Check size={16} />Connected care</span><span><Check size={16} />Made for everyday</span></div>
          </div>
          <div className="care-hero-art" aria-label="Illustration of connected healthcare">
            <div className="care-character-halo" /><div className="care-orbit care-orbit-one" />
            <img className="care-generated-characters" src="/careconnect-characters.png" alt="Friendly illustrated nurse supporting an older woman, with a care robot" />
            <div className="care-float-card care-float-top"><span className="care-art-icon"><Heart size={23} /></span><div><strong>Happier days</strong><span>A little care goes a long way.</span></div></div>
            <div className="care-float-card care-float-bottom"><span className="care-art-icon"><ShieldCheck size={23} /></span><div><strong>Your care, connected</strong><span>People and plans, together.</span></div></div>
            <span className="care-character-bubble care-bubble-one" /><span className="care-character-bubble care-bubble-two" />
          </div>
        </section>
        <section className="care-product-features" id="features" aria-label="CareConnect admin features">
          <article className="care-product-card"><span className="care-product-icon care-icon-purple"><ShieldCheck /></span><h2>Facility Overview</h2><p>Aggregate summary of resident population, staffing ratios, and average wellness metrics.</p><span className="care-product-tag">Executive Summary <ArrowUpRight size={15} /></span></article>
          <article className="care-product-card"><span className="care-product-icon care-icon-pink"><Users /></span><h2>Elder & Orphan Records</h2><p>Comprehensive resident forms, room allocations, emergency contacts, and care assignments.</p><span className="care-product-tag">Resident Directory <ArrowUpRight size={15} /></span></article>
          <article className="care-product-card"><span className="care-product-icon care-icon-blue"><Activity /></span><h2>Leave & Replacements</h2><p>Review staff leave requests and assign temporary replacement caretakers with MySQL audit.</p><span className="care-product-tag">Staff Allocation <ArrowUpRight size={15} /></span></article>
          <article className="care-product-card"><span className="care-product-icon care-icon-coral"><Bell /></span><h2>ML Systems Monitoring</h2><p>Real-time health status, version tracking, and maintenance toggles for backend AI components.</p><span className="care-product-tag">Component Registry <ArrowUpRight size={15} /></span></article>
        </section>
        <section className="care-journey" id="how" aria-label="How CareConnect admin operations work">
          <div className="care-journey-copy"><span className="care-eyebrow">ADMINISTRATIVE OPERATIONS</span><h2>Facility Control.<br /><span>Seamless Coordination.</span></h2><p>Centralized governance for elders, caretakers, and system infrastructure.</p><div className="care-journey-steps"><span><Users />Manage Residents</span><ArrowRight /><span><ShieldCheck />Assign Caretakers</span><ArrowRight /><span><Activity />Monitor Operations</span></div></div>
          <div className="care-companion-story"><img src="/careconnect-companion.png" alt="CareConnect administrative operations" loading="lazy" /><div><span className="care-eyebrow">SMART GOVERNANCE</span><h3>Dedicated to<br />Administration.</h3><p>Role-based management strictly isolated from direct clinical interactions.</p></div></div>
        </section>
        <section className="care-photo-story" aria-label="Care with a human touch"><img src="/careconnect-care.jpg" alt="Illustrative healthcare conversation in a bright care room" loading="lazy" /><div className="care-photo-copy"><span className="care-eyebrow">ADMINISTRATIVE GOVERNANCE</span><h2>Reliable care.<br />Operational excellence.</h2><p>Supporting facility staff and ensuring comprehensive safety oversight across all departments.</p><span className="care-photo-sticker">CareConnect Administration ✦</span></div></section>
        <section className="care-features" aria-label="CareConnect architecture">
          <div className="care-feature-intro"><span className="care-eyebrow">3-TIER SYSTEM ARCHITECTURE</span><h2>Role-Isolated Platform<br />Strict Permissions.</h2></div>
          <article className="care-feature"><span className="care-feature-icon"><ShieldCheck /></span><h3>Admin Web App</h3><p>Facility overview, resident & caretaker forms, leave approval, and ML component monitoring.</p><span className="care-feature-label">ADMIN WEB DASHBOARD</span></article>
          <article className="care-feature"><span className="care-feature-icon"><Users /></span><h3>Caretaker Mobile App</h3><p>Assigned roster, prescription scanner, medication logging, leave requests, and SOS alert dispatch.</p><span className="care-feature-label">CARETAKER MOBILE APP</span></article>
          <article className="care-feature"><span className="care-feature-icon"><Heart /></span><h3>Elder/Orphan Mobile App</h3><p>Self medication tracking, appointments, facial emotion & vocal AI, and personalized 7-day meal plans.</p><span className="care-feature-label">PATIENT MOBILE APP</span></article>
        </section>
      </main>
      <footer className="care-landing-footer"><span>CareConnect · Caring today. Brighter tomorrow.</span><span>Thoughtfully connected.</span></footer>
    </div>
  );
}
