import React, { useEffect, useMemo, useState } from 'react';
import { XIcon, CheckIcon, TemplateIcon } from './Icons';
import { approveProfile, patchBlock, setFieldMode, type Align, type BlockType, type TemplateProfile } from '../utils/scanTemplate';
import { getPageImages, getProfile, getScanDraft, saveProfile, type StoredScanDraft } from '../utils/scanProfileStore';

const TYPES: BlockType[] = [
  'court_heading', 'title', 'heading', 'party', 'para', 'numbered', 'subpara',
  'signature', 'verification_heading', 'verification', 'annexure_heading', 'annexure', 'table', 'other',
];

const ALIGNS: Align[] = ['left', 'center', 'right', 'justify'];

const typeLabel = (t: BlockType) =>
  ({
    court_heading: 'Court heading',
    title: 'Title',
    heading: 'Heading',
    party: 'Party',
    para: 'Paragraph',
    numbered: 'Numbered',
    subpara: 'Sub-paragraph',
    signature: 'Signature',
    verification_heading: 'Verification heading',
    verification: 'Verification',
    annexure_heading: 'Annexure heading',
    annexure: 'Annexure',
    table: 'Table',
    other: 'Other',
  }[t] || t);

export const ScanTemplateCheck = ({
  messageId,
  language,
  onClose,
}: {
  messageId: string;
  language: string;
  onClose: () => void;
}) => {
  const hi = language === 'Hindi';
  const [draft, setDraft] = useState<StoredScanDraft | null>(null);
  const [profile, setProfile] = useState<TemplateProfile | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let dead = false;
    const urls: string[] = [];
    void (async () => {
      const rec = await getScanDraft(messageId);
      if (!rec || dead) return;
      setDraft(rec);
      const p = await getProfile(rec.profileId);
      if (!p || dead) return;
      setProfile(p);
      setSelected(p.blocks[0]?.id || null);
      const blobs = await getPageImages(rec.profileId);
      if (blobs?.length && !dead) {
        blobs.forEach((b) => urls.push(URL.createObjectURL(b)));
        setThumbs(urls);
      }
    })();
    return () => {
      dead = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [messageId]);

  const fieldMode = (id: string) => profile?.fields.find((f) => f.id === id || f.id.startsWith(id + '.'))?.mode || 'keep';
  const sel = profile?.blocks.find((b) => b.id === selected);
  const selBox = useMemo(() => {
    if (!profile || !sel) return null;
    const line = profile.lines.find((l) => sel.lineIds.includes(l.id) && l.page === page);
    return line?.box || sel.table?.box || null;
  }, [profile, sel, page]);

  if (!profile || !draft) {
    return (
      <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4">
        <div className="text-sm text-band-mute">{hi ? 'टेम्पलेट पढ़ा जा रहा है…' : 'Loading the template reading…'}</div>
      </div>
    );
  }

  const failed = draft.checks.filter((c) => !c.ok);
  const warn = profile.review.filter((r) => r.severity === 'warn');

  const apply = (next: TemplateProfile) => {
    setProfile(next);
    setSaved('');
  };

  const saveApproved = async () => {
    const next = approveProfile(profile);
    await saveProfile(next);
    setProfile(next);
    setSaved(hi
      ? 'यह पढ़ना सहेज लिया गया। अगली बार यही टेम्पलेट फ़ाइल अपलोड होने पर यही ढाँचा इस्तेमाल होगा। वर्तमान ड्राफ्ट नहीं बदला।'
      : 'Saved. The next draft from this same template file will use this reading. The current draft is unchanged.');
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-stretch justify-center p-2 sm:p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-5xl bg-ink-muted border border-ink-border rounded-xl overflow-hidden flex flex-col shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-border">
          <div className="flex items-center gap-2 min-w-0">
            <TemplateIcon className="w-4 h-4 text-band-dim shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-band truncate">{hi ? 'टेम्पलेट जाँच' : 'Template check'}</div>
              <div className="text-[11px] text-band-mute truncate">
                {profile.name} · {profile.pages.length} {hi ? 'पृष्ठ' : 'page(s)'} · {profile.approved ? (hi ? 'स्वीकृत' : 'approved') : (hi ? 'अभी स्वीकृत नहीं' : 'not yet approved')}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-neutral-800" aria-label="Close">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 text-[11px] text-band-mute border-b border-ink-border">
          {hi
            ? 'मूल स्कैन नहीं बदला जाता। OCR पाठ अलग रखा गया है। यहाँ हेडिंग, शैली और कौन-सी पंक्तियाँ केस की हैं, यह सुधारें।'
            : 'The original scan is never changed. OCR text is kept separately. Correct headings, styles, and which lines belong to the sample case.'}
        </div>

        {(warn.length > 0 || failed.length > 0 || draft.review.length > 0) && (
          <div className="px-4 py-2 text-xs border-b border-ink-border max-h-28 overflow-y-auto space-y-1">
            {failed.map((c) => (
              <div key={c.name} className="text-amber-300">⚠ {c.detail}</div>
            ))}
            {warn.map((r) => (
              <div key={r.id} className="text-amber-200">{r.message}</div>
            ))}
            {draft.review.slice(0, 8).map((r, i) => (
              <div key={`r${i}`} className="text-band-dim">• {r}</div>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
          <div className="p-3 border-b md:border-b-0 md:border-r border-ink-border overflow-y-auto">
            {thumbs.length > 0 ? (
              <div>
                <div className="flex gap-1 mb-2">
                  {thumbs.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPage(i + 1)}
                      className={`px-2 py-0.5 text-[11px] rounded ${page === i + 1 ? 'bg-white text-black' : 'bg-neutral-800 text-band-dim'}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <div className="relative inline-block max-w-full bg-white">
                  <img src={thumbs[page - 1]} alt="" className="max-h-[52vh] max-w-full block" />
                  {selBox && (
                    <div
                      className="absolute border-2 border-amber-400/90 pointer-events-none"
                      style={{
                        left: `${selBox.x * 100}%`,
                        top: `${selBox.y * 100}%`,
                        width: `${selBox.w * 100}%`,
                        height: `${selBox.h * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-band-mute p-4">{hi ? 'इस डिवाइस पर स्कैन पृष्ठ नहीं मिले।' : 'Scan pages were not found on this device.'}</div>
            )}
          </div>

          <div className="overflow-y-auto p-3 space-y-2">
            {profile.blocks.map((b) => {
              const mode = fieldMode(b.id);
              const active = b.id === selected;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setSelected(b.id);
                    if (b.pages[0]) setPage(b.pages[0]);
                  }}
                  className={`w-full text-left rounded-lg border px-2 py-1.5 ${active ? 'border-white/40 bg-neutral-800' : 'border-ink-border bg-ink'}`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-band-mute">
                    <span>{typeLabel(b.type)}{b.bold ? ' · bold' : ''}{b.underline ? ' · underline' : ''} · {b.align}{mode !== 'keep' ? ` · ${mode}` : ''}</span>
                    <span>p.{b.pages.join(',')}</span>
                  </div>
                  <div className="text-xs text-band mt-0.5 line-clamp-3 whitespace-pre-wrap">{b.table ? b.table.cells.map((r) => r.join(' | ')).join('\n') : b.text}</div>
                </button>
              );
            })}
          </div>
        </div>

        {sel && (
          <div className="border-t border-ink-border px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <label className="flex flex-col gap-1 text-band-mute">
              {hi ? 'प्रकार' : 'Type'}
              <select
                className="bg-ink border border-ink-border rounded px-2 py-1 text-band"
                value={sel.type}
                onChange={(e) => apply(patchBlock(profile, sel.id, { type: e.target.value as BlockType }))}
              >
                {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-band-mute">
              {hi ? 'संरेखण' : 'Align'}
              <select
                className="bg-ink border border-ink-border rounded px-2 py-1 text-band"
                value={sel.align}
                onChange={(e) => apply(patchBlock(profile, sel.id, { align: e.target.value as Align }))}
              >
                {ALIGNS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-band pt-5">
              <input type="checkbox" checked={sel.bold} onChange={(e) => apply(patchBlock(profile, sel.id, { bold: e.target.checked }))} />
              Bold
            </label>
            <label className="flex items-center gap-2 text-band pt-5">
              <input type="checkbox" checked={sel.underline} onChange={(e) => apply(patchBlock(profile, sel.id, { underline: e.target.checked }))} />
              Underline
            </label>
            <label className="flex flex-col gap-1 text-band-mute col-span-2">
              {hi ? 'केस की पंक्ति?' : 'Sample-case line?'}
              <select
                className="bg-ink border border-ink-border rounded px-2 py-1 text-band"
                value={fieldMode(sel.id)}
                onChange={(e) => {
                  const mode = e.target.value as 'keep' | 'values' | 'rewrite';
                  if (mode === 'keep' || mode === 'rewrite') {
                    apply(setFieldMode(profile, sel.id, mode));
                    return;
                  }
                  const existing = profile.fields.find((f) => f.id === sel.id)?.samples || [];
                  const typed = existing.length
                    ? existing
                    : (window.prompt(
                      hi ? 'इस पंक्ति में नमूना केस के शब्द, अल्पविराम से अलग:' : 'Sample-case strings in this line, comma-separated:',
                      ''
                    ) || '').split(',').map((s) => s.trim()).filter(Boolean);
                  apply(setFieldMode(profile, sel.id, 'values', typed));
                }}
              >
                <option value="keep">{hi ? 'नहीं — ज्यों का त्यों रखें' : 'No — keep as boilerplate'}</option>
                <option value="values">{hi ? 'हाँ — नाम/तारीख/संख्या बदलें' : 'Yes — replace names/dates/numbers'}</option>
                <option value="rewrite">{hi ? 'पूरा पैरा केस का है' : 'Whole paragraph is case-specific'}</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-ink-border">
          <div className="text-[11px] text-band-mute max-w-xl">{saved}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg bg-neutral-800 text-white">{hi ? 'बंद करें' : 'Close'}</button>
            <button
              type="button"
              onClick={() => { void saveApproved(); }}
              className="px-3 py-1.5 text-xs rounded-lg bg-white text-black flex items-center gap-1.5"
            >
              <CheckIcon className="w-3.5 h-3.5" />
              {hi ? 'स्वीकार कर सहेजें' : 'Approve and save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
