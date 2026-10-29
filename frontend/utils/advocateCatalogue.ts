/**
 * Advocate template catalogue: 28 practice areas and every document / pleading
 * type from the Casemate "Indian Legal Drafting Template Master Catalogue".
 *
 * Each item is a blank LAYOUT, not a court-ready form. The layout is chosen by
 * the kind of document (notice, petition, plaint, reply, application, appeal,
 * agreement, deed, affidavit ...) and headed with the item's own title. The AI
 * fills it only from the advocate's case papers; missing facts stay ________.
 * Statute references stay as placeholders so the draft cites the law that
 * actually applies (for criminal matters: BNSS / CrPC as per the offence date).
 *
 * Content is generated on demand (catalogueTemplateContent) so ~600 layouts do
 * not sit in memory or the chat component's render path.
 */

export type CatalogueOption = {
  id: string;
  name: string;
  group: string;
  collapsible: true;
};

const CATALOGUE: Array<{ group: string; items: string[]; criminal?: boolean }> = [
  {
    group: 'Criminal Law — Police Complaints & Investigation',
    criminal: true,
    items: [
      'Complaint to police station',
      'Complaint to Superintendent of Police / senior police authority',
      'Request/application for registration of FIR, where legally appropriate',
      'Private criminal complaint before Magistrate',
      'Application seeking investigation by Magistrate',
      'Protest petition against closure/final report',
      'Application for further investigation',
      'Application for monitoring / status report, where maintainable',
      'Application for copy of FIR or police records, subject to applicable rules',
      'Complaint concerning assault, criminal intimidation, theft, cheating, fraud, misappropriation or trespass',
      'Representation concerning missing person / missing property',
      'Complaint concerning cybercrime or online financial fraud',
      'Application for protection from threats, where appropriate',
      'Application for preservation of CCTV / electronic evidence',
      'Application for production or preservation of relevant records',
    ],
  },
  {
    group: 'Criminal Law — Bail, Custody & Bonds',
    criminal: true,
    items: [
      'Regular bail application',
      'Anticipatory bail application',
      'Interim bail application',
      'Default/statutory bail application',
      'Bail application after filing of charge-sheet',
      'Bail application before Sessions Court',
      'Bail application before High Court',
      'Special Leave Petition (Criminal) relating to bail, where appropriate',
      'Application for suspension of sentence pending appeal',
      'Application for bail pending appeal',
      'Application to modify / relax bail conditions',
      'Application for extension of time to surrender, where maintainable',
      'Application for cancellation of bail',
      'Reply to bail cancellation application',
      'Bail bond',
      'Personal bond',
      'Surety bond',
      'Surety affidavit / solvency documents checklist',
      'Application for release of a person from custody where legally permissible',
      'Application for interim release of seized property / vehicle',
    ],
  },
  {
    group: 'Criminal Law — Trial & Defence Applications',
    criminal: true,
    items: [
      'Application for discharge',
      'Reply / objections to prosecution application',
      'Application relating to framing, alteration or correction of charge',
      'Application for exemption from personal appearance',
      'Application for exemption on a particular hearing date',
      'Application for recalling a witness',
      'Application for further cross-examination / recall for cross-examination',
      'Application to summon defence witness',
      'Application to summon documents or records',
      'Application for production of CCTV / electronic records',
      'Application for preservation of electronic evidence',
      'Application challenging admissibility of evidence, where appropriate',
      'Application for return / release of seized property',
      'Application for release of vehicle on interim custody',
      'Application for compounding of offence, where legally permitted',
      'Application for plea bargaining, where legally available',
      'Written submissions on behalf of accused',
      'Written submissions on behalf of complainant / prosecution, as appropriate',
      'Application for supply of relied-upon documents',
      'Application for inspection of case records',
      'Application for recording additional evidence, where maintainable',
      'Application for transfer of criminal case',
      'Application for early hearing / expeditious trial',
    ],
  },
  {
    group: 'Criminal Law — Appeals, Revision & Quashing',
    criminal: true,
    items: [
      'Criminal appeal against conviction',
      'Criminal appeal against acquittal, by a party legally entitled to appeal',
      'Appeal against sentence / quantum of sentence',
      'Application for suspension of sentence',
      'Criminal revision petition',
      'Petition to quash FIR / criminal proceedings',
      'Petition challenging summoning order',
      'Petition challenging an order on charge, where maintainable',
      'Petition challenging a criminal court order',
      'Criminal transfer petition',
      'Special Leave Petition (Criminal)',
      'Review petition, where maintainable',
      'Curative petition, only where exceptional legal requirements are met',
      'Application for condonation of delay in criminal appeal / revision',
      'Application for exemption from filing certified copy, where permitted',
      'Application for interim protection / stay, where maintainable',
      'Counter-affidavit in criminal petition',
      'Rejoinder affidavit in criminal petition',
    ],
  },
  {
    group: 'Civil Litigation — Suits & Pleadings',
    items: [
      'Plaint for recovery of money',
      'Suit for breach of contract',
      'Suit for damages / compensation',
      'Suit for declaration',
      'Suit for permanent injunction',
      'Suit for mandatory injunction',
      'Suit for possession of immovable property',
      'Suit for partition',
      'Suit for specific performance of contract',
      'Suit for cancellation / setting aside of document or deed',
      'Suit for accounts',
      'Suit for dissolution of partnership',
      'Suit for mesne profits',
      'Suit for defamation, subject to applicable law',
      'Suit for recovery of loan / outstanding dues',
      'Summary suit, where maintainable',
      'Interpleader suit',
      'Written statement',
      'Replication / rejoinder, where permitted',
      'Counterclaim',
      'Set-off pleading',
      'Additional written statement',
      'Amended plaint',
      'Amended written statement',
      'Application for amendment of pleadings',
      'Compromise / consent terms in civil suit',
      'Application to withdraw suit',
    ],
  },
  {
    group: 'Civil Litigation — Interim & Procedural Applications',
    items: [
      'Temporary injunction application',
      'Ex parte interim injunction application',
      'Application for appointment of local commissioner',
      'Application for attachment before judgment',
      'Application seeking security, where legally available',
      'Application for impleadment of a party',
      'Application for deletion / striking out of a party',
      'Application for amendment of pleadings',
      'Application for condonation of delay',
      'Application for restoration of dismissed suit',
      'Application to set aside ex parte decree',
      'Application for extension of time',
      'Application for stay of proceedings',
      'Application for transfer of case',
      'Application for inspection of court record',
      'Application to summon / produce documents',
      'Application to take additional documents on record',
      'Application for early hearing / expedited proceedings',
      'Application for adjournment',
      'Application for exemption from personal appearance',
      'Application for withdrawal of suit / application',
      'Application for substitution of legal representatives',
      'Application for permission to lead additional evidence, where maintainable',
      'Application for return of original documents',
      'Application for recording compromise',
      'Application for restoration of an application dismissed for default',
    ],
  },
  {
    group: 'Civil Litigation — Execution & Enforcement',
    items: [
      'Execution petition',
      'Execution application for money decree',
      'Execution application for delivery of possession',
      'Application for attachment of property',
      'Application for enforcement of injunction decree',
      'Application for arrest / detention in execution, only where legally permissible',
      'Objections to execution',
      'Application for stay of execution',
      'Application for recording satisfaction of decree',
      'Application for release / disbursement of deposited amount',
      'Application for restoration of execution proceedings',
      'Application concerning adjustment / appropriation of decree payments',
      'Application for enforcement of settlement / consent decree, where appropriate',
    ],
  },
  {
    group: 'Family & Matrimonial Law',
    items: [
      'Contested divorce petition',
      'Mutual-consent divorce petition',
      'Reply to divorce petition',
      'Petition for judicial separation',
      'Petition for restitution of conjugal rights',
      'Petition for nullity / annulment of marriage',
      'Interim maintenance application',
      'Permanent alimony / maintenance application',
      'Application for litigation expenses',
      'Reply to maintenance application',
      'Maintenance petition for spouse',
      'Maintenance petition for child',
      'Maintenance petition for parents',
      'Child custody petition',
      'Guardianship petition',
      'Visitation / parenting-time application',
      'Application to modify custody / visitation order',
      'Application for interim custody',
      'Matrimonial settlement agreement',
      'Consent terms in matrimonial proceedings',
      'Application for return of stridhan / personal articles',
      'Execution of maintenance order',
      'Appeal against family court order, where maintainable',
      'Transfer petition in matrimonial proceedings',
      'Application for waiver of statutory waiting period, where legally available',
      'Affidavit / disclosure of assets and liabilities, as required by applicable rules',
    ],
  },
  {
    group: 'Domestic Violence & Women/Child Protection',
    items: [
      'Application under the Protection of Women from Domestic Violence Act',
      'Application for interim / ex parte protection order',
      'Application for residence order',
      'Application for monetary relief',
      'Application for compensation order',
      'Application for temporary custody-related relief',
      'Reply to domestic violence application',
      'Application for enforcement of protection order',
      'Appeal against an order under the applicable Act',
      'Complaint / representation to appropriate protection authority',
      'Application seeking confidentiality / in-camera proceedings, where appropriate',
      'Child protection authority representation',
      'Juvenile Justice-related application for authorised legal practitioners',
      'Application concerning victim / witness protection, where available',
    ],
  },
  {
    group: 'Negotiable Instruments Act — Cheque Dishonour',
    criminal: true,
    items: [
      'Legal demand notice under Section 138',
      'Reply to cheque dishonour notice',
      'Complaint under Section 138',
      'Supporting affidavit / verification',
      'List of documents and annexures',
      'Application for condonation of delay, where permissible',
      'Application for exemption from personal appearance',
      'Application for interim compensation',
      'Reply / objections to interim compensation',
      'Application relating to evidence by affidavit',
      'Application to summon bank / postal records',
      'Application for compounding / settlement',
      'Compromise petition',
      'Settlement agreement and payment undertaking',
      'Criminal appeal against conviction',
      'Revision petition, where maintainable',
      'Application for suspension of sentence / bail pending appeal',
    ],
  },
  {
    group: 'Property, Land & Revenue',
    items: [
      'Eviction notice',
      'Notice for termination of tenancy',
      'Notice for unpaid rent',
      'Reply to eviction / tenancy notice',
      'Eviction suit / petition under applicable local law',
      'Rent recovery suit',
      'Suit for possession',
      'Suit for declaration of title / rights',
      'Suit for partition of property',
      'Suit for permanent injunction against interference / encroachment',
      'Suit for cancellation of sale deed',
      'Suit for specific performance of sale agreement',
      'Application for temporary injunction in property dispute',
      'Application for appointment of local commissioner',
      'Application for mutation of land records',
      'Objection to mutation proceedings',
      'Revenue appeal',
      'Revenue revision, where available',
      'Application for correction of land records',
      'Representation concerning demarcation / boundary dispute',
      'Complaint / application concerning illegal encroachment',
      'Application for certified copies of revenue records',
      'Lease deed',
      'Rent agreement',
      'Leave and licence agreement',
      'Agreement to sell',
      'Sale deed',
      'Gift deed',
      'Partition deed',
      'Release / relinquishment deed',
      'Mortgage deed',
      'Possession letter / possession memo',
      'Family settlement deed',
      'General Power of Attorney',
      'Special Power of Attorney',
      'Construction / contractor agreement',
    ],
  },
  {
    group: 'Legal Notices & Replies',
    items: [
      'General legal notice',
      'Reply to legal notice',
      'Money recovery notice',
      'Notice for breach of contract',
      'Notice claiming damages / compensation',
      'Defamation notice',
      'Notice for termination of agreement',
      'Notice for specific performance',
      'Notice to vacate premises',
      'Notice for refund of security deposit',
      'Notice for unpaid salary / employment dues',
      'Notice for wrongful termination',
      'Notice to builder for delay / deficiency',
      'Notice for deficiency in service',
      'Notice for insurance claim rejection / settlement',
      'Notice for repayment of loan',
      'Notice to bank / financial institution',
      'Notice invoking arbitration',
      'Statutory notice to government / public officer, where applicable',
      'Reply to show-cause notice',
      'Reply to departmental notice',
      'Notice concerning confidentiality / trade secrets',
      'Notice concerning intellectual property infringement',
      'Notice concerning online defamation / impersonation',
      'Notice for refund of admission / educational fees',
      'Notice for return of documents / property',
    ],
  },
  {
    group: 'Consumer Protection',
    items: [
      'Consumer complaint before District Commission',
      'Consumer complaint before State Commission',
      'Consumer complaint before National Commission',
      'Written version / reply by opposite party',
      'Rejoinder, where permitted',
      'Affidavit of evidence',
      'Application for condonation of delay',
      'Application for interim relief',
      'Application to produce additional documents',
      'Execution application for consumer order',
      'Appeal against consumer commission order',
      'Revision petition, where maintainable',
      'Complaint for defective product',
      'Complaint for deficiency in service',
      'Complaint for insurance claim rejection',
      'Complaint concerning builder / real estate service',
      'Complaint concerning e-commerce transaction',
      'Complaint for refund of educational fees, where maintainable',
      'Application for restoration / recall, where legally available',
    ],
  },
  {
    group: 'Writs & Constitutional Litigation',
    items: [
      'Writ petition under Article 226',
      'Writ petition under Article 32',
      'Habeas corpus petition',
      'Mandamus petition',
      'Certiorari petition',
      'Prohibition petition',
      'Quo warranto petition',
      'Public Interest Litigation (PIL)',
      'Counter-affidavit',
      'Rejoinder affidavit',
      'Interim relief / stay application',
      'Application for urgent hearing',
      'Application for impleadment',
      'Application for intervention',
      'Transfer petition',
      'Review petition, where maintainable',
      'Special Leave Petition (Civil)',
      'Application for condonation of delay',
      'Written submissions',
      'Synopsis and list of dates',
      'Application for modification / clarification of order',
      'Application for compliance / implementation of judgment',
    ],
  },
  {
    group: 'Labour, Employment & Service Law',
    items: [
      'Employment legal notice',
      'Notice for unpaid salary / dues',
      'Reply to show-cause notice',
      'Reply to charge-sheet',
      'Representation against suspension',
      'Representation against transfer',
      'Representation against termination',
      'Appeal against disciplinary order',
      'Claim for reinstatement / back wages, where legally available',
      'Labour dispute claim',
      'Written statement before Labour Court / Tribunal',
      'Application for interim relief',
      'Industrial dispute pleading',
      'Gratuity claim',
      'Provident fund-related representation / appeal',
      'Employee compensation claim',
      'Service writ petition',
      'Original Application before CAT, where jurisdiction applies',
      'Reply / counter-affidavit before tribunal',
      'Rejoinder before tribunal',
      'Application for stay of transfer / suspension',
      'Workplace harassment complaint / response template with confidentiality safeguards',
      'Settlement agreement / full and final settlement',
      'Employment agreement',
      'Consultancy agreement',
      'Non-disclosure agreement',
    ],
  },
  {
    group: 'Motor Accident Claims',
    items: [
      'MACT claim petition for death',
      'MACT claim petition for bodily injury',
      'Claim for permanent disability',
      'Claim for property damage',
      'Written statement by insurer',
      'Reply by vehicle owner / driver',
      'Affidavit of evidence',
      'Application to summon medical / accident records',
      'Application for interim compensation, where applicable',
      'Settlement application',
      'Appeal against MACT award',
      'Application for enhancement of compensation',
      'Application for release / disbursement of compensation',
      'Application for deposit / withdrawal of award amount',
    ],
  },
  {
    group: 'Arbitration & Commercial Disputes',
    items: [
      'Notice invoking arbitration',
      'Reply to arbitration notice',
      'Application for appointment of arbitrator',
      'Application under Section 9 of the Arbitration and Conciliation Act',
      'Application under Section 11',
      'Statement of claim',
      'Statement of defence',
      'Counterclaim',
      'Rejoinder',
      'Interim relief application before tribunal',
      'Application challenging tribunal jurisdiction',
      'Application for extension of arbitral mandate',
      'Petition to set aside arbitral award under Section 34',
      'Appeal under Section 37, where applicable',
      'Application for enforcement of award',
      'Application for stay of award',
      'Commercial suit',
      'Commercial summary suit, where maintainable',
      'Pre-institution mediation documents, where required',
      'Statement of truth',
      'Commercial court written statement',
      'Application for disclosure / inspection of documents',
      'Settlement agreement',
      'Application for appointment of commissioner / expert, where appropriate',
    ],
  },
  {
    group: 'Banking, Debt Recovery & Insolvency',
    items: [
      'Loan recovery legal notice',
      'Reply to recovery notice',
      'Debt recovery suit',
      'Original Application before DRT',
      'Written statement / reply before DRT',
      'Securitisation application under SARFAESI Act',
      'Reply to bank possession notice',
      'Objections to auction of secured property',
      'Application for interim stay',
      'Appeal before DRAT',
      'Loan settlement / one-time settlement request',
      'Guarantor liability notice',
      'Insolvency demand notice',
      'Reply to insolvency demand notice',
      'Corporate insolvency application under IBC',
      'Reply / objections in insolvency proceedings',
      'Personal guarantor insolvency-related pleading',
      'Proof of claim and supporting documents',
      'Application for recovery of outstanding dues',
      'Application for setting aside / challenging auction, where maintainable',
    ],
  },
  {
    group: 'Corporate & Company Law',
    items: [
      'Memorandum of Understanding',
      "Founders' agreement",
      "Shareholders' agreement",
      'Share subscription agreement',
      'Share transfer agreement',
      'Non-disclosure agreement',
      'Service agreement',
      'Consultancy agreement',
      'Vendor agreement',
      'Partnership deed',
      'LLP agreement',
      'Joint venture agreement',
      'Board resolution',
      'Shareholder resolution',
      'Notice of board meeting',
      'Minutes of meeting',
      'Company legal notice',
      'Reply to company law notice',
      'Petition / application before NCLT',
      'Reply to NCLT petition',
      'Appeal before NCLAT, where maintainable',
      'Oppression and mismanagement petition',
      'Winding-up / liquidation-related application, as legally applicable',
      'Corporate settlement agreement',
      'Employment / executive service agreement',
      'Software development agreement',
      'Share purchase agreement',
    ],
  },
  {
    group: 'Tax, GST & Revenue Proceedings',
    items: [
      'Reply to income-tax show-cause notice',
      'Reply to GST show-cause notice',
      'Reply to GST demand notice',
      'Application for rectification',
      'Appeal against tax assessment',
      'Appeal against GST demand / order',
      'Application for stay of tax recovery',
      'Reply to penalty proceedings',
      'Revision application, where permitted',
      'Representation to tax authority',
      'Application for refund',
      'Reply to search / seizure-related notice',
      'Appeal before relevant tribunal',
      'Writ petition concerning tax proceedings, where appropriate',
      'Application for condonation of delay',
      'Application for release of seized records / property, where available',
    ],
  },
  {
    group: 'Intellectual Property, Technology & Cyber Law',
    items: [
      'Trademark infringement notice',
      'Trademark opposition',
      'Trademark rectification-related pleading',
      'Copyright infringement notice',
      'Copyright licence agreement',
      'Copyright assignment agreement',
      'Patent-related legal notice',
      'Passing-off suit',
      'IP infringement suit',
      'Reply to IP notice',
      'Confidentiality / trade-secret agreement',
      'Software development agreement',
      'Software licence agreement',
      'Website terms of service',
      'Privacy policy',
      'Data breach notice / response',
      'Cybercrime complaint',
      'Complaint concerning online impersonation',
      'Complaint concerning unauthorised use of digital content',
      'Domain name dispute documents',
      'Platform takedown / grievance representation',
    ],
  },
  {
    group: 'Education, Admission & Fee Disputes',
    items: [
      'Legal notice for refund of admission fees',
      'Reply to education-related legal notice',
      'Complaint / representation to university or regulator',
      'Representation against examination result',
      'Appeal against disciplinary action',
      'Petition challenging admission cancellation',
      'Complaint concerning withheld certificates',
      'Application for release of academic documents',
      'Writ petition regarding admission / examination, where appropriate',
      'Consumer complaint, where maintainable',
      'Application for interim relief',
      'Reply to show-cause notice from educational institution',
      'Representation regarding scholarship / fee adjustment',
    ],
  },
  {
    group: 'Succession, Inheritance & Probate',
    items: [
      'Petition for probate of will',
      'Petition for letters of administration',
      'Succession certificate application',
      'Objection to probate petition',
      'Petition / suit challenging a will',
      'Suit for partition among legal heirs',
      'Legal heirship-related application under applicable state procedure',
      'Application for mutation after death',
      'Family settlement deed',
      'Relinquishment / release deed',
      'Will',
      'Codicil',
      'Affidavit of legal heirs',
      'Application for appointment of guardian',
      'Objections to succession proceedings',
      'Application for preservation / inventory of estate property, where appropriate',
    ],
  },
  {
    group: 'Administrative, Tribunal & Government Proceedings',
    items: [
      'Representation to government department',
      'Statutory appeal',
      'Departmental revision petition',
      'Appeal against administrative order',
      'Application for stay',
      'Counter-affidavit',
      'Rejoinder',
      'Application for impleadment',
      'Application for condonation of delay',
      'Application for restoration',
      'Application for early hearing',
      'Original Application before CAT',
      'Tribunal reply / written statement',
      'Appeal before state / specialist tribunal',
      'Application for certified copies',
      'Application for enforcement of tribunal order',
      'Application for interim protection',
    ],
  },
  {
    group: 'Agreements, Deeds & Conveyancing',
    items: [
      'Residential rent agreement',
      'Commercial lease agreement',
      'Leave and licence agreement',
      'Agreement to sell',
      'Sale deed',
      'Gift deed',
      'Mortgage deed',
      'Release / relinquishment deed',
      'Partition deed',
      'Partnership deed',
      'Family settlement',
      'General Power of Attorney',
      'Special Power of Attorney',
      'Affidavit and declaration',
      'Indemnity bond',
      'Guarantee agreement',
      'Loan agreement',
      'Promissory note',
      'Memorandum of Understanding',
      'Employment agreement',
      'Consultancy agreement',
      'Franchise agreement',
      'Supply agreement',
      'Distribution agreement',
      'Construction agreement',
      'Contractor agreement',
      'Settlement / compromise agreement',
      'Non-disclosure agreement',
      'Will and codicil',
      'Deed of dissolution of partnership',
      'Service-level agreement',
    ],
  },
  {
    group: 'General-Purpose Court Documents',
    items: [
      'Vakalatnama',
      'Affidavit',
      'Verification',
      'Synopsis',
      'List of dates and events',
      'Index',
      'Memo of parties',
      'List of documents',
      'List of witnesses',
      'Written submissions',
      'Notes of arguments',
      'Application for urgent listing',
      'Mentioning memo, where used',
      'Application for certified copy',
      'Application for exemption',
      'Application for condonation of delay',
      'Application for amendment',
      'Application for impleadment',
      'Application for intervention',
      'Application for adjournment',
      'Application for withdrawal',
      'Application for restoration',
      'Application for substitution of legal representatives',
      'Death-of-party memo / intimation',
      'Application for extension of time',
      'Application for taking documents on record',
      'Affidavit of service',
      'Proof / certificate of service',
      'Reply',
      'Rejoinder',
      'Compromise memo',
      'Consent terms',
      'No-objection certificate for change of advocate, where required',
      'Application for return of original documents',
      'Application for inspection of court file',
      'Application for exemption from filing originals / certified copies, where permitted',
    ],
  },
  {
    group: 'Supreme Court-Specific Filing Types',
    items: [
      'Special Leave Petition (Civil)',
      'Special Leave Petition (Criminal)',
      'Civil appeal',
      'Criminal appeal',
      'Transfer petition (Civil)',
      'Transfer petition (Criminal)',
      'Review petition',
      'Curative petition, subject to strict legal requirements',
      'Writ petition',
      'Interlocutory application',
      'Application for exemption from filing certified copies, where permitted',
      'Application for condonation of delay',
      'Counter-affidavit',
      'Rejoinder affidavit',
      'Caveat',
      'Vakalatnama / prescribed appearance documents',
      'Application for intervention / impleadment',
      'Application for modification of order',
      'Application for clarification of order',
      'Application for early hearing / listing',
    ],
  },
  {
    group: 'Other Specialist Areas',
    items: [
      'RERA complaint against promoter / builder',
      'Reply to RERA complaint',
      'Appeal against RERA order',
      'Cooperative society dispute application',
      'Reply in cooperative society proceedings',
      'Electricity billing / disconnection complaint',
      'Environmental complaint / statutory appeal',
      'Human rights commission complaint',
      'Election petition, subject to applicable law and limitation',
      'Trust deed',
      'Society bye-laws',
      'Trust / society registration-related documents',
      'Mediation request',
      'Conciliation agreement',
      'Settlement terms',
      'Municipal notice reply',
      'Property tax objection',
      'Local authority administrative appeal',
      'Insurance claim representation',
      'Insurance ombudsman complaint, where applicable',
      'Utility service dispute complaint',
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Classification: which blank layout fits this document type          */
/* ------------------------------------------------------------------ */

type Kind =
  | 'bail' | 'bond' | 'application' | 'plaint' | 'reply' | 'notice' | 'petition'
  | 'appeal' | 'representation' | 'affidavit' | 'schedule' | 'submissions'
  | 'vakalatnama' | 'compromise' | 'agreement' | 'deed' | 'will' | 'resolution' | 'policy';

const kindOf = (rawTitle: string): Kind => {
  const t = rawTitle.toLowerCase().trim();
  const starts = (re: RegExp) => re.test(t);

  if (starts(/^(reply|response|written statement|written version|statement of defence|counter-?affidavit|rejoinder|replication|additional written statement|amended written statement|tribunal reply|commercial court written statement|objection)/) || /\breply\b/.test(t)) return 'reply';
  if (starts(/^(written submissions|notes of arguments)/)) return 'submissions';
  if (starts(/^vakalatnama/)) return 'vakalatnama';
  if (starts(/^(application|interlocutory application|caveat|pre-institution mediation)/)) return 'application';
  if (/application$/.test(t) && !starts(/^(original|securitisation|execution|corporate|succession|cooperative|revision)/)) return 'application';
  if (starts(/^(cybercrime complaint|loan settlement)/)) return 'representation';
  if (starts(/^(supporting affidavit|affidavit|verification|statement of truth)/)) return 'affidavit';
  if (starts(/^(synopsis|list of|index|memo of parties|proof \/ certificate of service|death-of-party memo|mentioning memo|surety affidavit|trust \/ society registration)/) || /checklist/.test(t)) return 'schedule';
  if (starts(/^(compromise|consent terms|settlement terms)/)) return 'compromise';
  if (starts(/^(board resolution|shareholder resolution|notice of board meeting|minutes of meeting)/)) return 'resolution';
  if (starts(/^(will\b|codicil)/)) return 'will';
  if (starts(/^(bail bond|personal bond|surety bond)/)) return 'bond';
  if (/(terms of service|privacy policy|bye-laws)/.test(t)) return 'policy';
  if (starts(/^(regular|anticipatory|interim|default\/statutory)? ?bail application|^bail application/)) return 'bail';
  if (/\bnotice\b/.test(t)) return 'notice';
  if (starts(/^(environmental complaint|workplace harassment complaint|no-objection)/)) return 'representation';
  if (/appeal/.test(t)) return 'appeal';
  if (starts(/^(plaint|suit|summary suit|interpleader|amended plaint|counterclaim|set-off|statement of claim|commercial suit|commercial summary suit|passing-off suit|ip infringement suit|debt recovery suit|eviction suit|rent recovery suit)/)) return 'plaint';
  if (/(sale deed|gift deed|mortgage deed|partition deed|relinquishment deed|possession letter|power of attorney|trust deed|family settlement|deed of dissolution|partnership deed|lease deed|indemnity bond|promissory note)/.test(t)) return 'deed';
  if (/(agreement|memorandum of understanding|conciliation)/.test(t)) return 'agreement';
  if (starts(/^(consumer complaint|private criminal complaint|complaint under section 138|rera complaint|complaint for|complaint concerning (builder|e-commerce)|complaint before)/)) return 'petition';
  if (starts(/^(complaint|representation|request|mediation request|insurance|utility|electricity|human rights|municipal|property tax|local authority|platform|child protection|data breach)/)) return 'representation';
  return 'petition';
};

/** Drop trailing qualifiers such as ", where maintainable" from the heading. */
const cleanTitle = (title: string) =>
  title
    .replace(/,\s*(where|subject to|only where|only|as appropriate|as required|as legally|by a party).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ */
/* Blank layouts                                                       */
/* ------------------------------------------------------------------ */

const LAW_CIVIL = '[PROVISION OF LAW / SECTION AND ACT]';
const LAW_CRIMINAL = '[SECTION AND ACT — BNSS, 2023 / CrPC, 1973 AND BNS / IPC, AS APPLICABLE ON THE DATE OF THE OFFENCE]';

const court = (forum = '[COURT / TRIBUNAL / FORUM / AUTHORITY]') =>
  `[CENTER]**[U]IN THE ${forum} OF [NAME AND PLACE][/U]**[/CENTER]`;
const caseNo = (label = '[CASE TYPE]') => `[CENTER]**${label} NO. [NUMBER] OF [YEAR]**[/CENTER]`;
const between = (a: string, aRole: string, b: string, bRole: string) =>
  `**${a}** ...${aRole}\n**VERSUS**\n**${b}** ...${bRole}`;
const heading = (t: string) => `[CENTER]**[U]${t}[/U]**[/CENTER]`;
const signRow = (role = '[PETITIONER / APPLICANT]') => `[ROW]
Place: [PLACE]
Date: [DATE]
|
**${role}**
THROUGH COUNSEL
**[ADVOCATE NAME]**
Advocate
[/ROW]`;
const verification = (what: string) => `${heading('VERIFICATION')}
Verified at [PLACE] on this [DATE] that the contents of paragraphs 1 to [N] of the above ${what} are true and correct to my knowledge, paragraphs [N] to [N] are based on legal advice and believed to be true, and nothing material has been concealed.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**DEPONENT**
[/ROW]`;
const annexures = `${heading('LIST OF ANNEXURES')}
Annexure A-1: [DOCUMENT AND DATE]
Annexure A-2: [DOCUMENT AND DATE]
Annexure A-3: [DOCUMENT AND DATE]`;

type Ctx = { title: string; law: string };

const layouts: Record<Kind, (c: Ctx) => string> = {
  petition: ({ title, law }) => `${court()}
${caseNo()}

${between('[PETITIONER / COMPLAINANT / CLAIMANT]', '[ROLE]', '[RESPONDENT / ACCUSED / OPPOSITE PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}
[CENTER]**UNDER ${law}**[/CENTER]

**MOST RESPECTFULLY SHOWETH:**
1. That the petitioner is [DESCRIPTION AND ADDRESS] and the respondent is [DESCRIPTION AND ADDRESS].
2. That [FACTS IN ORDER, WITH DATES].
[INSERT FACTS]
N. That the cause of action arose on [DATE] at [PLACE]; this Hon'ble Court has jurisdiction and the petition is within limitation.
N. That no other proceeding on the same subject is pending, except [DETAILS, IF ANY].

${heading('GROUNDS')}
A. [GROUND IN LAW OR FACT]
B. [GROUND IN LAW OR FACT]

${heading('PRAYER')}
It is therefore respectfully prayed that this Hon'ble Court may be pleased to: (a) [PRINCIPAL RELIEF]; (b) [INTERIM RELIEF, IF ANY]; (c) pass any other order as this Court deems fit in the interest of justice.

${signRow()}

${verification('petition')}

${annexures}`,

  plaint: ({ title }) => `${court('COURT')}
[CENTER]**CIVIL SUIT NO. [NUMBER] OF [YEAR]**[/CENTER]

${between('[PLAINTIFF]', 'PLAINTIFF', '[DEFENDANT]', 'DEFENDANT')}

${heading(title.toUpperCase())}
[CENTER]**PLAINT UNDER ORDER VII RULE 1 OF THE CODE OF CIVIL PROCEDURE, 1908**[/CENTER]

**The plaintiff most respectfully submits:**
1. That the plaintiff is [DESCRIPTION AND ADDRESS]; the defendant is [DESCRIPTION AND ADDRESS].
2. That [FACTS IN ORDER, WITH DATES, DOCUMENTS AND AMOUNTS].
[INSERT FACTS]
N. That the plaintiff issued notice dated [DATE], to which [REPLY / NO REPLY WAS RECEIVED].
N. **Cause of action:** the cause of action arose on [DATE] at [PLACE] and continues.
N. **Jurisdiction:** territorial: [GROUNDS]; pecuniary: [GROUNDS]; subject-matter: [GROUNDS].
N. **Limitation:** the suit is within limitation because [GROUNDS].
N. **Valuation and court fee:** the suit is valued at Rs. [AMOUNT] for jurisdiction and Rs. [AMOUNT] for court fee, which has been paid.
N. That no other suit between the parties on the same cause is pending or decided.

${heading('PRAYER')}
The plaintiff prays for a decree: (a) [PRINCIPAL RELIEF]; (b) [ALTERNATIVE / CONSEQUENTIAL RELIEF]; (c) interest [PENDENTE LITE AND FUTURE] at [RATE]%; (d) costs of the suit; (e) any other relief the Court deems fit.

${signRow('[PLAINTIFF]')}

${verification('plaint')}

${heading('LIST OF DOCUMENTS')}
1. [DOCUMENT, DATE, ORIGINAL / COPY]
2. [DOCUMENT, DATE, ORIGINAL / COPY]`,

  reply: ({ title }) => `${court()}
${caseNo()}

${between('[PETITIONER / PLAINTIFF / COMPLAINANT]', '[ROLE]', '[RESPONDENT / DEFENDANT / OPPOSITE PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}
[CENTER]**ON BEHALF OF THE [RESPONDENT / DEFENDANT / OPPOSITE PARTY]**[/CENTER]

**MOST RESPECTFULLY SHOWETH:**

**PRELIMINARY OBJECTIONS**
1. That [MAINTAINABILITY / JURISDICTION / LIMITATION OBJECTION].
2. That [FURTHER OBJECTION, IF ANY].

**REPLY ON MERITS (PARA-WISE)**
1. That the contents of paragraph 1 are [ADMITTED / DENIED / PARTLY ADMITTED] because [REASON].
2. That the contents of paragraph 2 are [ADMITTED / DENIED / PARTLY ADMITTED] because [REASON].
[CONTINUE FOR EACH PARAGRAPH]

**ADDITIONAL FACTS AND SUBMISSIONS**
N. That [FACT OR SUBMISSION IN ORDER].
[INSERT FACTS]

${heading('PRAYER')}
It is therefore prayed that this Hon'ble Court may be pleased to dismiss / reject the [PETITION / SUIT / APPLICATION] with costs.

${signRow('[RESPONDENT / DEFENDANT]')}

${verification('reply')}`,

  notice: ({ title }) => `${heading(title.toUpperCase())}

Ref. No. [NUMBER]
Date: [DATE]
**BY [REGISTERED POST AD / SPEED POST / EMAIL / COURIER]**

**To,**
[NAME AND ADDRESS OF THE NOTICEE]

**Subject: [SUBJECT OF THE NOTICE]**

Sir / Madam,
Under instructions from and on behalf of my client **[CLIENT NAME AND ADDRESS]**, I serve you with this notice:
1. That my client [RELATIONSHIP / TRANSACTION WITH THE NOTICEE, WITH DATES].
2. That [FACTS IN ORDER, WITH AMOUNTS AND DOCUMENTS].
[INSERT FACTS]
N. That your acts / omissions amount to [BREACH / DEFAULT / DEFICIENCY / OFFENCE] under [PROVISION OF LAW / SECTION AND ACT].

Therefore, I call upon you to [DEMAND: PAY Rs. [AMOUNT] / VACATE / RESTORE / COMPLY / WITHDRAW] within [15 / 30] days of receipt of this notice, failing which my client shall be constrained to initiate [CIVIL / CRIMINAL / OTHER] proceedings against you at your risk as to costs and consequences. This notice is issued without prejudice to my client's other rights and remedies, and the cost of this notice, Rs. [AMOUNT], shall be payable by you.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[ADVOCATE NAME]**
Advocate for [CLIENT NAME]
Enrolment No. [NUMBER]
[/ROW]`,

  application: ({ title, law }) => `${court()}
[CENTER]**IN [MAIN CASE TYPE] NO. [NUMBER] OF [YEAR]**[/CENTER]

${between('[PARTY]', '[ROLE]', '[PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}
[CENTER]**UNDER ${law}**[/CENTER]

**MOST RESPECTFULLY SHOWETH:**
1. That the above matter is pending before this Hon'ble Court and is listed on [DATE] for [PURPOSE].
2. That [FACTS SUPPORTING THE APPLICATION, IN ORDER].
[INSERT FACTS]
N. That the applicant has a good case and the balance of convenience favours the applicant; no prejudice will be caused to the other side.
N. That this application is made bona fide and in the interest of justice.

${heading('PRAYER')}
It is therefore prayed that this Hon'ble Court may be pleased to [RELIEF SOUGHT] and pass any other order it deems fit.

${signRow('[APPLICANT]')}

[CENTER]**(Affidavit in support is annexed)**[/CENTER]`,

  bail: ({ title, law }) => `${court()}
[CENTER]**BAIL APPLICATION NO. [NUMBER] OF [YEAR]**[/CENTER]
[CENTER]**IN FIR / CRIME NO. [NUMBER] OF [YEAR], POLICE STATION [PS]**[/CENTER]

${between('[APPLICANT / ACCUSED]', 'APPLICANT', 'STATE OF [STATE] / [COMPLAINANT]', 'RESPONDENT')}

${heading(title.toUpperCase())}
[CENTER]**UNDER ${law}**[/CENTER]

**MOST RESPECTFULLY SHOWETH:**
1. That the applicant is [DESCRIPTION, AGE, OCCUPATION, ADDRESS, FAMILY AND TIES TO THE PLACE].
2. That FIR No. [NUMBER] dated [DATE] was registered at Police Station [PS] under [SECTIONS AND ACT] on the allegation that [ALLEGATIONS IN BRIEF].
3. That the applicant was arrested on [DATE] and has been in [POLICE / JUDICIAL] custody since [DATE]. [FOR ANTICIPATORY BAIL: THE APPLICANT APPREHENDS ARREST BECAUSE [REASONS].]
4. That the status of investigation / trial is [STATUS: CHARGE-SHEET FILED OR NOT, NEXT DATE].
[INSERT FACTS]

**GROUNDS FOR BAIL**
A. That the applicant is innocent and has been falsely implicated because [REASONS].
B. That the material on record does not disclose [INGREDIENTS OF THE OFFENCE].
C. That the applicant has no criminal antecedents, [OR: THE ANTECEDENTS ARE [DETAILS] AND ARE EXPLAINED AS FOLLOWS].
D. That there is no risk of the applicant absconding or tampering with evidence or witnesses; the applicant will join the investigation and abide by every condition imposed.
E. That the applicant has been in custody for [PERIOD]; the trial will take time; [PARITY WITH CO-ACCUSED, IF ANY].

${heading('PRAYER')}
It is therefore prayed that this Hon'ble Court may be pleased to release the applicant on bail in the above matter on such terms and conditions as the Court deems fit.

${signRow('[APPLICANT / ACCUSED]')}

[CENTER]**(Affidavit in support is annexed)**[/CENTER]`,

  bond: ({ title }) => `${court()}
${caseNo('[CASE TYPE]')}

${heading(title.toUpperCase())}

I, **[NAME]**, son / daughter / wife of [NAME], aged [AGE] years, resident of [ADDRESS], [THE ACCUSED / SURETY FOR THE ACCUSED] in [CASE / FIR NO.], Police Station [PS], under [SECTIONS AND ACT], do hereby bind myself to pay to the State / the Court a sum of Rs. [AMOUNT] ([AMOUNT IN WORDS]) if I fail to comply with the conditions below:
1. That the accused shall appear before the Court on every date of hearing and whenever required.
2. That the accused shall not leave the jurisdiction of the Court without prior permission.
3. That the accused shall not tamper with the evidence or influence any witness.
4. [ANY OTHER CONDITION IMPOSED BY THE COURT.]

[FOR A SURETY: I own [PROPERTY / SOLVENCY DETAILS WITH DOCUMENT REFERENCES] worth Rs. [AMOUNT].]

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[EXECUTANT / SURETY]**
Signature: ________
[/ROW]

Accepted by the Court on [DATE].`,

  appeal: ({ title }) => `${court('[APPELLATE COURT]')}
[CENTER]**[CASE TYPE] APPEAL NO. [NUMBER] OF [YEAR]**[/CENTER]

${between('[APPELLANT]', 'APPELLANT', '[RESPONDENT]', 'RESPONDENT')}

${heading(title.toUpperCase())}
[CENTER]**MEMORANDUM OF APPEAL UNDER [PROVISION OF LAW / SECTION AND ACT]**[/CENTER]

**Appeal against the judgment and [ORDER / DECREE / SENTENCE] dated [DATE] passed by [NAME OF COURT / AUTHORITY] in [CASE NO.].**

**MOST RESPECTFULLY SHOWETH:**
1. That the appellant being aggrieved by the impugned [JUDGMENT / ORDER] preferred this appeal on the following facts.
2. That [FACTS OF THE CASE AND PROCEEDINGS BELOW, IN ORDER].
[INSERT FACTS]
N. That the appeal is within limitation; the certified copy was applied for on [DATE] and received on [DATE]. [ANY DELAY IS EXPLAINED IN THE ACCOMPANYING APPLICATION.]

${heading('GROUNDS OF APPEAL')}
A. Because [GROUND: ERROR IN LAW OR FACT].
B. Because [GROUND].
C. Because [GROUND].

${heading('PRAYER')}
It is therefore prayed that this Hon'ble Court may be pleased to: (a) [ALLOW THE APPEAL AND SET ASIDE / MODIFY THE IMPUGNED JUDGMENT / ORDER]; (b) [STAY THE OPERATION OF THE IMPUGNED ORDER PENDING THE APPEAL]; (c) pass any other order it deems fit.

${signRow('[APPELLANT]')}

${annexures}`,

  representation: ({ title }) => `${heading(title.toUpperCase())}

Date: [DATE]

**To,**
The [DESIGNATION OF THE AUTHORITY]
[OFFICE / DEPARTMENT / POLICE STATION / FORUM]
[ADDRESS]

**Subject: [SUBJECT AND REFERENCE NUMBER, IF ANY]**

Respected Sir / Madam,
I, **[NAME]**, [DESCRIPTION AND ADDRESS], respectfully submit as follows:
1. That [BACKGROUND AND RELATIONSHIP WITH THE MATTER].
2. That [FACTS IN ORDER, WITH DATES, PLACES AND PERSONS INVOLVED].
[INSERT FACTS]
N. That [EARLIER COMPLAINTS OR REPRESENTATIONS MADE, WITH DATES AND OUTCOME].

**Relief requested:** I request that [ACTION REQUESTED FROM THE AUTHORITY] be taken within [PERIOD], and that a copy of the action taken be given to me.

**Enclosures:** 1. [DOCUMENT] 2. [DOCUMENT] 3. [ID PROOF]

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[NAME OF COMPLAINANT]**
Contact: [PHONE / EMAIL]
Through counsel: [ADVOCATE NAME]
[/ROW]`,

  affidavit: ({ title }) => `${court()}
${caseNo()}

${between('[PARTY]', '[ROLE]', '[PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}

I, **[NAME OF DEPONENT]**, son / daughter / wife of [NAME], aged [AGE] years, resident of [ADDRESS], do hereby solemnly affirm and state on oath as under:
1. That I am the [ROLE OF DEPONENT] in the above matter and am competent to swear this affidavit.
2. That [STATEMENT OF FACTS, EACH IN A SEPARATE PARAGRAPH].
[INSERT FACTS]
N. That the documents annexed are true copies of their originals.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**DEPONENT**
[/ROW]

${heading('VERIFICATION')}
Verified at [PLACE] on this [DATE] that the contents of this affidavit are true and correct to my knowledge and belief, and nothing material has been concealed or falsely stated.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**DEPONENT**
[/ROW]`,

  schedule: ({ title }) => `${court()}
${caseNo()}

${between('[PARTY]', '[ROLE]', '[PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}

S. No. | Particulars | Date | Page No.
1. [PARTICULARS / EVENT / DOCUMENT] | [DATE] | [PAGE]
2. [PARTICULARS / EVENT / DOCUMENT] | [DATE] | [PAGE]
3. [PARTICULARS / EVENT / DOCUMENT] | [DATE] | [PAGE]
[CONTINUE AS REQUIRED, IN ORDER]

${signRow('[PARTY]')}`,

  submissions: ({ title }) => `${court()}
${caseNo()}

${between('[PETITIONER / APPELLANT / COMPLAINANT]', '[ROLE]', '[RESPONDENT / ACCUSED]', '[ROLE]')}

${heading(title.toUpperCase())}
[CENTER]**ON BEHALF OF THE [PARTY]**[/CENTER]

**1. Brief facts.** [FACTS IN ORDER, WITH DATES AND DOCUMENTS]

**2. Issues for consideration.**
(i) [ISSUE 1]
(ii) [ISSUE 2]

**3. Submissions.**
**Issue (i):** [SUBMISSION, WITH REFERENCE TO THE EVIDENCE / RECORD, PAGE NUMBERS AND THE LAW]
**Issue (ii):** [SUBMISSION, WITH REFERENCE TO THE EVIDENCE / RECORD AND THE LAW]

**4. Judgments relied on.** [CITATIONS PROVIDED BY THE ADVOCATE ONLY; MARK ANY OTHER AS TO BE VERIFIED]

**5. Conclusion and prayer.** It is submitted that [CONCLUSION] and the Hon'ble Court may be pleased to [RELIEF].

${signRow('[PARTY]')}`,

  vakalatnama: ({ title }) => `${court()}
${caseNo()}

${between('[PARTY]', '[ROLE]', '[PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}

I / We, **[NAME(S) OF CLIENT(S)]**, the [ROLE] in the above matter, residing at [ADDRESS], do hereby appoint and retain **[ADVOCATE NAME]**, Advocate, Enrolment No. [NUMBER], [ADDRESS OF OFFICE], to appear, act and plead for me / us in the above matter and in all proceedings arising from it, to sign and file pleadings, applications and appeals, to produce and withdraw documents, to examine and cross-examine witnesses, to compromise or withdraw the matter with my / our consent, to receive money and give receipts as permitted, and to do everything necessary in this behalf.

I / We agree to ratify all acts done by the Advocate in pursuance of this authority.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[SIGNATURE OF CLIENT(S)]**
[/ROW]

**Accepted:**
[ADVOCATE NAME], Advocate`,

  compromise: ({ title }) => `${court()}
${caseNo()}

${between('[PARTY]', '[ROLE]', '[PARTY]', '[ROLE]')}

${heading(title.toUpperCase())}
[CENTER]**UNDER [ORDER 23 RULE 3 CPC / SECTION 320 CrPC / SECTION 359 BNSS / OTHER PROVISION]**[/CENTER]

The parties respectfully submit:
1. That the dispute between the parties relates to [SUBJECT OF THE DISPUTE].
2. That, with the intervention of well-wishers / counsel / the mediator, the parties have settled the dispute on the following terms:
(a) [TERM 1, WITH AMOUNT, DATE AND MODE OF PAYMENT]
(b) [TERM 2]
(c) [TERM 3]
3. That the settlement is lawful, voluntary and free from coercion, fraud or undue influence, and the parties have understood its terms.
4. That the parties pray that the Court may record the settlement and [PASS A DECREE IN TERMS OF THE COMPROMISE / DISPOSE OF THE MATTER / ACQUIT OR DISCHARGE THE ACCUSED].

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[PARTY 1]** ________
**[PARTY 2]** ________
[/ROW]

Counsel for [PARTY 1]: ________    Counsel for [PARTY 2]: ________`,

  agreement: ({ title }) => `${heading(title.toUpperCase())}

This **${title}** is made at [PLACE] on this [DATE], between:
**[PARTY A]**, [DESCRIPTION, ADDRESS, PAN / CIN / ID], (the "First Party"), and
**[PARTY B]**, [DESCRIPTION, ADDRESS, PAN / CIN / ID], (the "Second Party").

**WHEREAS** [BACKGROUND AND PURPOSE OF THE AGREEMENT].
**NOW, THEREFORE,** the parties agree as follows:

**1. Definitions and scope.** [DEFINITIONS AND SUBJECT MATTER]
**2. Term.** This agreement starts on [DATE] and continues for [PERIOD], unless ended earlier under clause [N].
**3. Consideration and payment.** [AMOUNT, SCHEDULE, MODE, TAXES]
**4. Rights and obligations.** [OBLIGATIONS OF EACH PARTY]
**5. Representations and warranties.** [REPRESENTATIONS OF EACH PARTY]
**6. Confidentiality.** [CONFIDENTIALITY TERMS, WHERE RELEVANT]
**7. Termination.** [GROUNDS, NOTICE PERIOD, CONSEQUENCES]
**8. Indemnity and liability.** [INDEMNITY AND LIMITATION OF LIABILITY]
**9. Dispute resolution and governing law.** [NEGOTIATION / MEDIATION / ARBITRATION SEAT AND RULES]; Indian law governs; courts at [CITY] have [EXCLUSIVE] jurisdiction.
**10. Stamp duty and registration.** [STAMP DUTY PAYABLE AND REGISTRATION REQUIREMENT AS PER APPLICABLE LAW]
**11. General.** [NOTICES, ASSIGNMENT, AMENDMENT IN WRITING, SEVERABILITY, ENTIRE AGREEMENT]
[ADD CLAUSES SPECIFIC TO THIS DOCUMENT TYPE]

**IN WITNESS WHEREOF** the parties have signed this agreement on the date first written above.

[ROW]
**[PARTY A]**
Signature: ________
|
**[PARTY B]**
Signature: ________
[/ROW]

Witnesses: 1. [NAME AND ADDRESS] ________    2. [NAME AND ADDRESS] ________`,

  deed: ({ title }) => `${heading(title.toUpperCase())}

**THIS ${title.toUpperCase()}** is executed at [PLACE] on this [DATE] by **[NAME OF EXECUTANT]**, son / daughter / wife of [NAME], aged [AGE], resident of [ADDRESS] (the "Executant"), in favour of **[NAME OF BENEFICIARY / OTHER PARTY]**, [DESCRIPTION AND ADDRESS] (the "Beneficiary").

**WHEREAS** [RECITALS: TITLE OF THE EXECUTANT, HOW THE PROPERTY OR RIGHT WAS ACQUIRED, AND THE REASON FOR THIS DEED].
**NOW THIS DEED WITNESSETH AS FOLLOWS:**
1. That, in consideration of [CONSIDERATION / LOVE AND AFFECTION / AGREED TERMS], the Executant [TRANSFERS / GIFTS / MORTGAGES / RELEASES / AUTHORISES: THE OPERATIVE ACT].
2. That the Executant states that the property / right is free from encumbrance, litigation and acquisition, except [EXCEPTIONS].
3. That possession is [DELIVERED / RETAINED] on [DATE].
4. That [FURTHER COVENANTS, TERMS, OBLIGATIONS AND CONDITIONS].
5. That the stamp duty and registration charges shall be borne by [PARTY], and the deed shall be registered as required by law.

**SCHEDULE OF PROPERTY**
[DESCRIPTION: SURVEY / KHASRA / PLOT / HOUSE NO., AREA, BOUNDARIES (NORTH, SOUTH, EAST, WEST), LOCATION AND REGISTRATION DETAILS]

**IN WITNESS WHEREOF** the Executant has signed this deed on the date first written above.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[EXECUTANT]**
Signature: ________
**[BENEFICIARY]**
Signature: ________
[/ROW]

Witnesses: 1. [NAME AND ADDRESS] ________    2. [NAME AND ADDRESS] ________`,

  will: ({ title }) => `${heading(title.toUpperCase())}

I, **[NAME OF TESTATOR]**, son / daughter / wife of [NAME], aged [AGE] years, resident of [ADDRESS], being of sound mind and in good health, make this my last Will voluntarily and free from any pressure, and revoke every earlier Will and codicil made by me.

1. **Executor.** I appoint [NAME AND ADDRESS] as the executor of this Will.
2. **Family.** My family consists of [SPOUSE, CHILDREN, OTHER HEIRS].
3. **Bequests.** I give [PROPERTY / ASSET, WITH DESCRIPTION] to [BENEFICIARY AND RELATIONSHIP]; I give [PROPERTY / ASSET] to [BENEFICIARY].
4. **Residue.** All the rest of my property shall go to [BENEFICIARY / BENEFICIARIES, IN SHARES].
5. **Conditions and directions.** [ANY CONDITION, GUARDIAN FOR MINORS, DIRECTIONS FOR DEBTS OR FUNERAL].

**SCHEDULE OF PROPERTY**
[DESCRIPTION OF EACH ITEM]

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[TESTATOR]**
Signature: ________
[/ROW]

Signed by the testator in our presence, and attested by us in the presence of the testator and of each other:
Witness 1: [NAME, ADDRESS] ________    Witness 2: [NAME, ADDRESS] ________`,

  resolution: ({ title }) => `${heading(title.toUpperCase())}
[CENTER]**[NAME OF COMPANY / LLP]**[/CENTER]
[CENTER]**CIN / LLPIN: [NUMBER]**    Registered office: [ADDRESS][/CENTER]

Meeting of the [BOARD OF DIRECTORS / SHAREHOLDERS / PARTNERS] held on [DATE] at [TIME] at [PLACE / VIDEO CONFERENCE].
**Present:** [NAMES AND DESIGNATIONS]    **In the chair:** [NAME]    **Quorum:** [PRESENT AND VALID]

**AGENDA / ITEM 1: [SUBJECT]**
**RESOLVED THAT** [TEXT OF THE RESOLUTION, WITH AUTHORITY AND LIMITS, AND THE PROVISION OF THE COMPANIES ACT, 2013 / LLP ACT OR ARTICLES RELIED ON].
**RESOLVED FURTHER THAT** [AUTHORISED PERSON(S): NAME AND DESIGNATION] is authorised to sign, file forms and documents, and do everything necessary to give effect to this resolution.

**AGENDA / ITEM 2: [SUBJECT]**
[DISCUSSION AND RESOLUTION]

There being no other business, the meeting ended at [TIME] with a vote of thanks to the chair.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[NAME], CHAIRPERSON / DIRECTOR**
Signature: ________
[/ROW]`,

  policy: ({ title }) => `${heading(title.toUpperCase())}
[CENTER]**[NAME OF ORGANISATION / WEBSITE / SOCIETY]**    Effective date: [DATE][/CENTER]

**1. Introduction and scope.** [WHO THIS DOCUMENT APPLIES TO AND WHAT IT COVERS]
**2. Definitions.** [KEY TERMS]
**3. Core provisions.** [RIGHTS, DUTIES, OR RULES, EACH IN A NUMBERED CLAUSE, AS FITS THIS DOCUMENT TYPE]
**4. Data / conduct / membership rules.** [WHERE RELEVANT: INFORMATION COLLECTED AND USED, USER OR MEMBER OBLIGATIONS]
**5. Grievance redressal.** [GRIEVANCE OFFICER, CONTACT AND TIME LIMIT]
**6. Changes and governing law.** [HOW CHANGES ARE NOTIFIED]; Indian law applies; courts at [CITY] have jurisdiction.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**[AUTHORISED SIGNATORY]**
[DESIGNATION]
[/ROW]`,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

type Entry = { id: string; title: string; group: string; criminal: boolean };

const ENTRIES: Entry[] = CATALOGUE.flatMap((g, gi) =>
  g.items.map((title, ii) => ({
    id: `cat_${gi + 1}_${ii + 1}`,
    title,
    group: g.group,
    criminal: !!g.criminal,
  }))
);

const ENTRY_BY_ID: Record<string, Entry> = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

/** One option per document type, grouped by practice area (28 groups). */
export const ADVOCATE_CATALOGUE_OPTIONS: CatalogueOption[] = ENTRIES.map((e) => ({
  id: e.id,
  name: e.title,
  group: e.group,
  collapsible: true,
}));

export const isCatalogueTemplateId = (id: string | null | undefined) =>
  !!id && Object.prototype.hasOwnProperty.call(ENTRY_BY_ID, id);

/** Blank layout for a catalogue item, built when the advocate picks it. */
export const catalogueTemplateContent = (id: string | null | undefined): string | null => {
  if (!id) return null;
  const entry = ENTRY_BY_ID[id];
  if (!entry) return null;
  const kind = kindOf(entry.title);
  return layouts[kind]({
    title: cleanTitle(entry.title),
    law: entry.criminal ? LAW_CRIMINAL : LAW_CIVIL,
  });
};

/** Exposed for tests and for reviewing how each item is laid out. */
export const catalogueKindOf = (title: string): string => kindOf(title);
