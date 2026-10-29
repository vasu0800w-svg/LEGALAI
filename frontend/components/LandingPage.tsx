import React, { useEffect, useRef, useState } from 'react';
import emailjs from '@emailjs/browser';
import { BrandLogo } from './BrandLogo';
import { useAppContext } from '../context/AppContext';
import { buildPlanCards, formatInr, getPlanLimits, sanitizeSubscriptionPlans } from '../utils/planLimits';
import { PromoCodeForm } from './PromoCodeForm';
import { CustomPlanBuilder } from './CustomPlanBuilder';
import './LandingPage.css';

type Props = {
  onSignIn: () => void;
  onStart: () => void;
};

const Icon = ({ d }: { d: string }) => (
  <svg className="cm-icon" viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const OWNER_EMAIL = 'meetcasemate@gmail.com';

type Inquiry = {
  kind: string;
  name: string;
  phone: string;
  email: string;
  needs?: string;
  trap?: string;
};

const sendToOwner = async (inquiry: Inquiry): Promise<boolean> => {
  const serviceId = String((import.meta as { env?: Record<string, string> }).env?.VITE_EMAILJS_SERVICE_ID || '');
  const publicKey = String((import.meta as { env?: Record<string, string> }).env?.VITE_EMAILJS_PUBLIC_KEY || '');
  const templateId = String((import.meta as { env?: Record<string, string> }).env?.VITE_EMAILJS_WELCOME_TEMPLATE_ID || '');
  if (!serviceId || !publicKey || !templateId) return false;
  const text = [
    inquiry.kind,
    `Name: ${inquiry.name}`,
    `Phone: ${inquiry.phone}`,
    `Email: ${inquiry.email}`,
    inquiry.needs ? `Needs: ${inquiry.needs}` : '',
    'Sent from the casemate website.',
  ].filter(Boolean).join('\n');
  await emailjs.send(
    serviceId,
    templateId,
    {
      email: OWNER_EMAIL,
      to_email: OWNER_EMAIL,
      user_email: OWNER_EMAIL,
      name: text,
      to_name: text,
      from_name: 'casemate website',
      from_email: OWNER_EMAIL,
      reply_to: inquiry.email,
      subject: inquiry.kind,
      message: text,
      app_name: 'casemate',
      app_url: 'https://meetcasemate.com',
    },
    publicKey
  );
  return true;
};

const features = [
  { title: 'FIR and document analysis', copy: 'Upload an FIR, order, notice, or other case papers. Casemate reads those files and works from the facts in them.', d: 'M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v6h6' },
  { title: 'Uploads and photos', copy: 'Add PDFs, scans, and photos to the chat for that matter so the analysis stays with those papers.', d: 'M12 16V6M8 10l4-4 4 4M5 19h14' },
  { title: 'Summaries and key facts', copy: 'Ask for a case summary or the main facts. The answer is taken from what you uploaded or typed, not from invented papers.', d: 'M5 6h14M5 12h14M5 18h8' },
  { title: 'Legal drafting assistance', copy: 'Ask for a notice, application, pleading, or, in Judge mode, a judgment draft. The layout follows the template you choose.', d: 'M5 19l4-1 9-9-3-3-9 9-1 4zM13 6l3 3' },
  { title: 'English and Hindi', copy: 'Use the app in English, Hindi, or another Indian language already offered in settings.', d: 'M5 6h14M5 12h8M5 18h14' },
  { title: 'Templates and formats', copy: 'Reuse advocate pleading types and, in Judge mode, judgment and order formats instead of starting from a blank page.', d: 'M8 4h8v16H8zM10 8h4M10 12h4' },
  { title: 'Edit and export', copy: 'Revise a generated draft in the editor, then export a Word file or a PDF.', d: 'M7 3h10v18H7zM9 8h6M9 12h6M9 16h4' },
  { title: 'Saved cases', copy: 'Open a matter again from your chat list. Advocate and Judge modes keep separate histories on the same account.', d: 'M6 6h12v9H9l-3 3z' },
];

const InquiryForm = ({
  kind,
  needsLabel,
  submitLabel,
}: {
  kind: string;
  needsLabel?: string;
  submitLabel: string;
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [needs, setNeeds] = useState('');
  const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === 'sending' || status === 'sent') return;
    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const cleanEmail = email.trim();
    const cleanNeeds = needs.trim();
    if (cleanName.length < 2 || cleanPhone.replace(/\D/g, '').length < 10 || !cleanEmail.includes('@')) {
      setStatus('error');
      return;
    }
    if (needsLabel && cleanNeeds.length < 8) {
      setStatus('error');
      return;
    }
    if (trap.trim()) {
      setStatus('sent');
      return;
    }
    setStatus('sending');
    try {
      const ok = await sendToOwner({
        kind,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        needs: cleanNeeds || undefined,
      });
      setStatus(ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return <p className="cm-form-note">Sent. We received your details at {OWNER_EMAIL}.</p>;
  }

  return (
    <form className="cm-form" onSubmit={onSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} name="name" autoComplete="name" required />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} name="tel" autoComplete="tel" inputMode="tel" required />
      </label>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} name="email" type="email" autoComplete="email" required />
      </label>
      {needsLabel && (
        <label>
          {needsLabel}
          <textarea value={needs} onChange={(e) => setNeeds(e.target.value)} name="needs" rows={4} required />
        </label>
      )}
      <label className="cm-trap" aria-hidden="true">
        Company
        <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" />
      </label>
      <button type="submit" className="cm-btn cm-btn-light" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : submitLabel}
      </button>
      {status === 'error' && (
        <p className="cm-form-note">Enter a name, a 10-digit phone number, and an email{needsLabel ? ', and describe what you need' : ''}. If it still fails, write to {OWNER_EMAIL}.</p>
      )}
    </form>
  );
};

const GROUP_URL = 'https://groups.google.com/g/casemate-beta-testers';

export const LandingPage = ({ onSignIn, onStart }: Props) => {
  const { subscriptionPlans } = useAppContext();
  const paidPlans = sanitizeSubscriptionPlans(subscriptionPlans.length > 0 ? subscriptionPlans : null);
  const freeLimits = getPlanLimits('free');
  const planCards = buildPlanCards(paidPlans, freeLimits);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pointAtTester, setPointAtTester] = useState(false);
  const [testerPopupOpen, setTesterPopupOpen] = useState(false);
  const testerOptInRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('casemate_tester_popup_closed') === '1') return;
    } catch {
      /* ignore */
    }
    setTesterPopupOpen(true);
  }, []);

  const closeTesterPopup = () => {
    setTesterPopupOpen(false);
    try {
      sessionStorage.setItem('casemate_tester_popup_closed', '1');
    } catch {
      /* ignore */
    }
  };

  const close = () => setMenuOpen(false);

  const showTesterStep = () => {
    setPointAtTester(true);
    window.setTimeout(() => {
      const button = testerOptInRef.current;
      if (!button) return;
      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      button.focus({ preventScroll: true });
    }, 60);
  };

  const openJoinGroup = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const width = 520;
    const height = 740;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    const popup = window.open(
      GROUP_URL,
      'casemateBetaGroup',
      `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`
    );
    if (!popup) {
      window.location.href = GROUP_URL;
      return;
    }
    popup.focus();
    const openedAt = Date.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onReturn);
      if (!popup.closed) popup.close();
      showTesterStep();
    };
    const timer = window.setInterval(() => {
      if (popup.closed) finish();
    }, 400);
    const onReturn = () => {
      if (Date.now() - openedAt < 2000) return;
      finish();
    };
    window.addEventListener('focus', onReturn);
  };

  return (
    <div className="cm-land">
      {testerPopupOpen && (
        <div className="cm-tester-overlay" role="dialog" aria-modal="true" aria-labelledby="cm-tester-popup-title">
          <div className="cm-tester-modal">
            <button type="button" className="cm-tester-close" onClick={closeTesterPopup} aria-label="Close">
              ×
            </button>
            <h2 id="cm-tester-popup-title">Become a Tester</h2>
            <p>Join the beta group first, with the Google account you use on your phone. Then open the Play testing page and tap Become a Tester. After that, download Casemate from the Play Store.</p>
            <div className="cm-tester-modal-actions">
              <a className="cm-btn cm-btn-light" href={GROUP_URL} onClick={(event) => { closeTesterPopup(); openJoinGroup(event); }}>Join Beta Group</a>
              <a className="cm-btn cm-btn-line" href="https://play.google.com/apps/testing/com.casemate.legalai" target="_blank" rel="noopener noreferrer">Become a Tester</a>
              <a className="cm-btn cm-btn-line" href="https://play.google.com/store/apps/details?id=com.casemate.legalai" target="_blank" rel="noopener noreferrer">Download on Play Store</a>
            </div>
          </div>
        </div>
      )}
      <a className="cm-skip" href="#home">Skip to content</a>
      <header className="cm-nav-bar">
        <div className="cm-wrap">
          <nav className="cm-nav" aria-label="Primary">
            <a className="cm-brand" href="#home" onClick={close}>
              <BrandLogo size={36} alt="Casemate" />
              casemate
            </a>
            <div className={menuOpen ? 'cm-links cm-open' : 'cm-links'}>
              <a href="#home" onClick={close}>Home</a>
              <a href="#platform" onClick={close}>Platform</a>
              <a href="#features" onClick={close}>Features</a>
              <a href="#how" onClick={close}>How It Works</a>
              <a href="#pricing" onClick={close}>Pricing</a>
              <a href="#promo" onClick={close}>Promo code</a>
              <a href="#tester" onClick={close}>Become a Tester</a>
              <a href="#contact" onClick={close}>Contact</a>
            </div>
            <div className="cm-nav-actions">
              <button type="button" className="cm-btn cm-btn-ghost" onClick={onSignIn}>Sign In</button>
              <button type="button" className="cm-btn cm-btn-light" onClick={onStart}>Get Started</button>
              <button
                type="button"
                className="cm-menu-btn"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span />
              </button>
            </div>
          </nav>
        </div>
      </header>

      <main>
        <section className="cm-wrap cm-hero" id="home">
          <div>
            <p className="cm-kicker">For Indian advocates and judges</p>
            <h1>AI-assisted case analysis and legal drafting</h1>
            <p className="cm-lead">Casemate helps advocates read case papers, pull out the facts, and prepare a first draft. You review every name, date, section, and prayer before anything is filed.</p>
            <div className="cm-row">
              <button type="button" className="cm-btn cm-btn-light" onClick={onStart}>Get Started</button>
              <a className="cm-btn cm-btn-line" href="#pricing">View Plans</a>
              <a className="cm-btn cm-btn-ghost" href="#features">Explore Features</a>
            </div>
          </div>
          <div className="cm-preview" aria-hidden="true">
            <div className="cm-preview-top">
              <span className="cm-dot" />
              <span className="cm-dot" />
              <span className="cm-dot" />
              <span>Draft preview</span>
            </div>
            <div className="cm-paper">
              <p className="center"><strong>IN THE COURT OF ________</strong></p>
              <p className="center cm-gold">BAIL APPLICATION</p>
              <p>Most respectfully showeth:</p>
              <p>1. That the applicant is ________, and the FIR number is ________.</p>
              <p>2. That the facts, in order, are taken from the papers uploaded in this matter.</p>
              <p><strong>Prayer.</strong> Release on bail on such terms as the Court deems fit.</p>
            </div>
            <p className="cm-note">An illustration of a draft layout. It is not a filed pleading.</p>
          </div>
        </section>

        <section className="cm-section" id="platform">
          <div className="cm-wrap">
            <h2>Built for the work advocates repeat</h2>
            <p className="cm-sub">Casemate prepares a first draft from your instructions and the files you provide. You decide what is filed.</p>
            <div className="cm-values">
              <article className="cm-value"><h3>Less repetition</h3><p>Start from a template instead of rebuilding the same headings, prayer, and verification each time.</p></article>
              <article className="cm-value"><h3>Facts in one place</h3><p>Keep the FIR, notices, orders, and photos with the chat for that matter.</p></article>
              <article className="cm-value"><h3>Drafting help</h3><p>Ask for a notice, application, pleading, or, in Judge mode, a judgment draft.</p></article>
              <article className="cm-value"><h3>Your review</h3><p>Correct names, dates, sections, and relief. The draft does not file itself.</p></article>
            </div>
          </div>
        </section>

        <section className="cm-section" id="features">
          <div className="cm-wrap">
            <h2>What you can do in Casemate</h2>
            <p className="cm-sub">These are the tools already in the app.</p>
            <div className="cm-grid">
              {features.map((item) => (
                <article className="cm-card" key={item.title}>
                  <Icon d={item.d} />
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cm-section" id="how">
          <div className="cm-wrap">
            <h2>How it works</h2>
            <div className="cm-steps cm-steps-flow">
              <article className="cm-step"><div className="cm-num">01</div><h3>Sign in</h3><p>Open your own account. Chats, uploads, and billing stay on that sign-in.</p></article>
              <article className="cm-step"><div className="cm-num">02</div><h3>Add the case</h3><p>Upload papers or photos, or type the facts you already have.</p></article>
              <article className="cm-step"><div className="cm-num">03</div><h3>Ask Casemate to analyse</h3><p>Use the chat to summarise the material or extract the key facts.</p></article>
              <article className="cm-step"><div className="cm-num">04</div><h3>Review the result</h3><p>Check names, dates, sections, and anything that looks incomplete.</p></article>
              <article className="cm-step"><div className="cm-num">05</div><h3>Draft, edit, export</h3><p>Generate a draft from a template, edit it, and export Word or PDF where supported.</p></article>
            </div>
          </div>
        </section>

        <section className="cm-section" id="standards">
          <div className="cm-wrap">
            <article className="cm-trust">
              <h2>Review before you rely on a draft</h2>
              <p>Casemate assists advocates. It does not replace a qualified legal professional, guarantee correct legal advice, guarantee court acceptance, or produce an infallible draft.</p>
              <ul>
                <li>AI-generated material must be reviewed by a qualified legal professional before it is used.</li>
                <li>Check names, dates, facts, citations, and the sections cited.</li>
                <li>The advocate or the judge remains responsible for the professional judgment.</li>
                <li>What comes out depends on the papers and the question you asked.</li>
                <li>Account data and chats stay with your sign-in. Read the <a href="/privacy">privacy policy</a> for what is kept and how to ask for deletion.</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="cm-section" id="pricing">
          <div className="cm-wrap">
            <h2>Plans</h2>
            <p className="cm-sub">Prices and limits below come from the same catalog used after you sign in. A free account is available. There is no separate timed trial beyond that free plan.</p>
            <div className="cm-prices">
              {planCards.map((card) => (
                <article className="cm-price" key={card.id}>
                  <h3>{card.name}</h3>
                  <div className="cm-amount">
                    {card.price === 0 ? '₹0' : formatInr(card.price)}
                    {card.periodLabel !== 'Free' ? <span>{card.periodLabel}</span> : null}
                  </div>
                  {card.savings ? (
                    <p className="cm-save">Save {formatInr(card.savings.saved)} versus {formatInr(card.savings.twelveMonthCost)} billed monthly ({card.savings.percent}% before tax).</p>
                  ) : null}
                  <dl className="cm-specs">
                    {card.specs.filter((s) => s.label !== 'Price period').map((spec) => (
                      <div key={spec.label}>
                        <dt>{spec.label}</dt>
                        <dd>{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <ul>
                    {card.features.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <button type="button" className={card.id === 'free' ? 'cm-btn cm-btn-light' : 'cm-btn cm-btn-line'} onClick={onStart}>
                    Get Started
                  </button>
                </article>
              ))}
            </div>
            <article className="cm-custom cm-custom-builder" id="custom-plan">
              <div>
                <h3>Custom plan</h3>
                <p>Set photos, characters, drafts, and devices from live unit prices. The total is calculated on the server. Sign in is required only at checkout. For a chamber-wide arrangement, write to {OWNER_EMAIL}.</p>
              </div>
              <CustomPlanBuilder variant="landing" onNeedSignIn={onSignIn} />
            </article>
          </div>
        </section>

        <section className="cm-section" id="promo">
          <div className="cm-wrap">
            <article className="cm-custom">
              <div>
                <h2>Have a promo code?</h2>
                <p>Enter it here. You will sign in first if you are not already in. A 14-day code lasts 14 days. An always code lasts until that code is changed.</p>
              </div>
              <PromoCodeForm variant="light" onNeedSignIn={onSignIn} />
            </article>
          </div>
        </section>

        <section className="cm-section" id="tester">
          <div className="cm-wrap">
            <h2>Become a tester</h2>
            <p className="cm-sub">Join the beta group first, with the Google account you use on your phone. Then open the Play testing page and tap Become a Tester. After that, download Casemate from the Play Store.</p>
            <div className="cm-steps">
              <article className="cm-step">
                <div className="cm-num">01</div>
                <h3>Join the beta group</h3>
                <p>A small window opens. Join the group there. When you come back, that window closes and the next step is selected.</p>
                <a className="cm-btn cm-btn-light" href={GROUP_URL} onClick={openJoinGroup}>Join Beta Group</a>
              </article>
              <article className="cm-step">
                <div className="cm-num">02</div>
                <h3>Opt in on Google Play</h3>
                <p>On the next page, tap Become a Tester. Use the same Google account.</p>
                <a
                  ref={testerOptInRef}
                  className={pointAtTester ? 'cm-btn cm-btn-line cm-point' : 'cm-btn cm-btn-line'}
                  href="https://play.google.com/apps/testing/com.casemate.legalai"
                  target="_blank"
                  rel="noopener noreferrer"
                >Become a Tester</a>
              </article>
              <article className="cm-step">
                <div className="cm-num">03</div>
                <h3>Download the app</h3>
                <p>Install Casemate from the Play Store once you are a tester.</p>
                <a className="cm-btn cm-btn-light" href="https://play.google.com/store/apps/details?id=com.casemate.legalai" target="_blank" rel="noopener noreferrer">Download on Play Store</a>
              </article>
            </div>
            <article className="cm-custom">
              <div>
                <h3>Or send your details</h3>
                <p>Share your name, phone, and email. After you submit, the request is sent to {OWNER_EMAIL}.</p>
              </div>
              <InquiryForm kind="Casemate tester request" submitLabel="Submit tester request" />
            </article>
          </div>
        </section>

        <section className="cm-wrap">
          <div className="cm-close">
            <h2>Make Your Legal Workflow Simpler</h2>
            <p>Explore how Casemate can assist with case analysis and legal drafting while keeping you in control.</p>
            <div className="cm-row">
              <button type="button" className="cm-btn cm-btn-light" onClick={onStart}>Get Started</button>
              <button type="button" className="cm-btn cm-btn-line" onClick={onSignIn}>Sign In</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="cm-wrap cm-foot" id="contact">
        <div>
          <a className="cm-brand" href="#home"><BrandLogo size={32} alt="" /> casemate</a>
          <p>An AI drafting assistant for Indian advocates and judges. Drafts are a starting point. Review them before you file.</p>
        </div>
        <div>
          <h3>Pages</h3>
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#pricing">Pricing and billing</a></li>
            <li><a href="/about">About</a></li>
            <li><a href="/ai-legal-drafting">AI legal drafting</a></li>
            <li><a href="/privacy">Privacy policy</a></li>
            <li><a href="/terms">Terms of use</a></li>
            <li><a href="/refund">Refunds and cancellation</a></li>
          </ul>
        </div>
        <div>
          <h3>Contact</h3>
          <p><a href="mailto:meetcasemate@gmail.com">meetcasemate@gmail.com</a></p>
          <p><a href={GROUP_URL} onClick={openJoinGroup}>Join Beta Group</a><br /><a href="https://play.google.com/apps/testing/com.casemate.legalai" target="_blank" rel="noopener noreferrer">Become a Tester</a><br /><a href="https://play.google.com/store/apps/details?id=com.casemate.legalai" target="_blank" rel="noopener noreferrer">Download on Play Store</a></p>
          <p><a href="/bail-application">Bail application</a><br /><a href="/legal-notice">Legal notice</a><br /><a href="/section-138-notice">Section 138 notice</a></p>
        </div>
      </footer>
    </div>
  );
};
