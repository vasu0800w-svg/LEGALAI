/**
 * Blank judgment / order formats for judges.
 *
 * These are LAYOUT skeletons only. Every [PLACEHOLDER] is filled from the case
 * papers the judge uploads; anything missing stays as ________. They use the
 * same editor tags as the advocate templates ([CENTER], [ROW], **bold**, [U]).
 *
 * Statute references are left as placeholders on purpose (CrPC / BNSS, IPC / BNS
 * and so on) so the draft cites whichever law actually governs the case.
 */

export type JudgementTemplateOption = {
  id: string;
  name: string;
  /** Short group label shown in the menu so judges can scan by court side. */
  group: 'Criminal' | 'Civil' | 'Family' | 'Special' | 'Orders';
};

const header = (caseLine: string) => `[CENTER]**[U]IN THE COURT OF [NAME OF COURT AND PLACE][/U]**[/CENTER]
[CENTER]**PRESENT: [NAME AND DESIGNATION OF PRESIDING OFFICER]**[/CENTER]
[CENTER]**${caseLine}**[/CENTER]
[CENTER]**CNR NO.: [CNR NUMBER]**[/CENTER]`;

const parties = (first: string, firstRole: string, second: string, secondRole: string) => `**${first}** ...${firstRole}
**VERSUS**
**${second}** ...${secondRole}`;

const dates = `Date of institution: [DATE]
Date of arguments concluded: [DATE]
Date of judgment: [DATE]`;

const signature = (role: string) => `[ROW]
Place: [PLACE]
Date: [DATE]
|
**([NAME OF PRESIDING OFFICER])**
${role}
[NAME OF COURT]
[/ROW]`;

const title = (text: string) => `[CENTER]**[U]${text}[/U]**[/CENTER]`;

const JUDGEMENT_TEMPLATE_LIST: Array<JudgementTemplateOption & { content: string }> = [
  {
    id: 'j_criminal_trial',
    name: 'Criminal Trial Judgment (Theft / Assault / Cheating etc.)',
    group: 'Criminal',
    content: `${header('SESSIONS CASE / CRIMINAL CASE NO. [NUMBER] OF [YEAR]')}

${parties('STATE OF [STATE] / [COMPLAINANT]', 'PROSECUTION', '[NAME OF ACCUSED]', 'ACCUSED')}

${dates}

${title('JUDGMENT')}

**1. The accusation.** FIR No. [NUMBER] dated [DATE], Police Station [PS], District [DISTRICT], for offences under [SECTIONS AND ACT, E.G. THEFT / HURT / CHEATING]. Charge framed on [DATE]; the accused pleaded not guilty and claimed trial.

**2. Case of the prosecution.** [BRIEF FACTS IN ORDER: DATE, PLACE, ROLE OF ACCUSED, RECOVERY OR INJURIES, INVESTIGATION AND CHARGE-SHEET]

**3. Defence of the accused.** [DEFENCE, INCLUDING STATEMENT UNDER SECTION 313 CrPC / SECTION 351 BNSS]

**4. Evidence led.** Prosecution witnesses: PW-1 [NAME] ([ROLE]); PW-2 [NAME] ([ROLE]); [OTHERS]. Documents and material exhibits: Ex. P-1 [DESCRIPTION]; [OTHERS]. Defence evidence: [IF ANY].

**5. Arguments.** For the prosecution: [SUBMISSIONS]. For the accused: [SUBMISSIONS].

**6. Points for determination.**
(i) [WHETHER THE INCIDENT OCCURRED AS ALLEGED]
(ii) [WHETHER THE ACCUSED COMMITTED THE ACT, WITH THE REQUIRED INTENTION OR KNOWLEDGE]
(iii) [WHETHER EACH INGREDIENT OF THE SECTIONS CHARGED IS PROVED]

**7. Appreciation of evidence and findings.** [WITNESS-WISE AND POINT-WISE DISCUSSION. CONSISTENCY OF TESTIMONY, INDEPENDENT CORROBORATION, DELAY, RECOVERY AND CHAIN OF CUSTODY, MEDICAL OR FORENSIC EVIDENCE, DEFENCE PLEA. EACH POINT ENDS WITH A FINDING.]

**8. Conclusion.** [THE PROSECUTION HAS / HAS NOT PROVED THE CHARGE BEYOND REASONABLE DOUBT. THE ACCUSED IS HELD GUILTY AND CONVICTED UNDER [SECTIONS] / IS GIVEN THE BENEFIT OF DOUBT AND ACQUITTED UNDER [SECTION 235(1) CrPC / SECTION 258 BNSS].]

**ORDER:** [IF CONVICTED: THE CONVICT SHALL BE HEARD ON SENTENCE ON [DATE]. / IF ACQUITTED: BAIL AND SURETY BONDS ARE DISCHARGED SUBJECT TO [SECTION 437A CrPC / SECTION 481 BNSS]; CASE PROPERTY TO BE DISPOSED OF AFTER THE APPEAL PERIOD.]

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_criminal_conviction',
    name: 'Criminal Trial Judgment – Conviction',
    group: 'Criminal',
    content: `${header('SESSIONS CASE / CRIMINAL CASE NO. [NUMBER] OF [YEAR]')}

${parties('STATE OF [STATE] / [COMPLAINANT]', 'PROSECUTION', '[NAME OF ACCUSED]', 'ACCUSED')}

${dates}

${title('JUDGMENT')}

**1. The accusation.** FIR No. [NUMBER] dated [DATE], Police Station [PS], District [DISTRICT], for offences under [SECTIONS AND ACT]. The accused was tried on the charge framed on [DATE].

**2. Case of the prosecution.** [BRIEF FACTS OF THE PROSECUTION CASE, IN ORDER]

**3. Charge and plea.** Charge under [SECTIONS] was framed and read over; the accused pleaded not guilty and claimed trial.

**4. Evidence led.**
(a) Prosecution witnesses: PW-1 [NAME] ([ROLE]); PW-2 [NAME] ([ROLE]); [OTHERS].
(b) Documents and material exhibits: Ex. P-1 [DESCRIPTION]; [OTHERS].
(c) Statement of the accused under [SECTION 313 CrPC / SECTION 351 BNSS]: [SUMMARY OF EXPLANATION / DENIAL].
(d) Defence evidence, if any: [DW-1 AND DOCUMENTS].

**5. Arguments.** Learned [PUBLIC PROSECUTOR / COUNSEL] for the prosecution submitted [SUBMISSIONS]. Learned counsel for the accused submitted [SUBMISSIONS].

**6. Points for determination.**
(i) [POINT 1]
(ii) [POINT 2]
(iii) [POINT 3]

**7. Appreciation of evidence and findings.**
**Point No. (i):** [DISCUSSION OF EVIDENCE AND REASONS] Finding: [PROVED / NOT PROVED].
**Point No. (ii):** [DISCUSSION AND REASONS] Finding: [PROVED / NOT PROVED].
**Point No. (iii):** [DISCUSSION AND REASONS] Finding: [PROVED / NOT PROVED].

**8. Conclusion.** For the reasons recorded above, the prosecution has proved beyond reasonable doubt that [CONCLUSION]. The accused is held **GUILTY** and is **CONVICTED** under [SECTIONS AND ACT].

${title('ORDER ON SENTENCE')}

The convict was heard on the question of sentence. [SUBMISSIONS ON SENTENCE, MITIGATING AND AGGRAVATING CIRCUMSTANCES, ANTECEDENTS.]

**ORDER:** The convict is sentenced to [SENTENCE] for the offence under [SECTION], and to fine of Rs. [AMOUNT], in default [DEFAULT SENTENCE]. [SENTENCES TO RUN CONCURRENTLY / CONSECUTIVELY.] The period already undergone in custody shall be set off under [SECTION 428 CrPC / SECTION 468 BNSS]. Case property shall be dealt with as follows: [DISPOSAL OF PROPERTY]. A free copy of this judgment be given to the convict.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_criminal_acquittal',
    name: 'Criminal Trial Judgment – Acquittal',
    group: 'Criminal',
    content: `${header('SESSIONS CASE / CRIMINAL CASE NO. [NUMBER] OF [YEAR]')}

${parties('STATE OF [STATE] / [COMPLAINANT]', 'PROSECUTION', '[NAME OF ACCUSED]', 'ACCUSED')}

${dates}

${title('JUDGMENT')}

**1. The accusation.** FIR No. [NUMBER] dated [DATE], Police Station [PS], for offences under [SECTIONS AND ACT]. Charge framed on [DATE].

**2. Case of the prosecution.** [BRIEF FACTS]

**3. Defence of the accused.** [DEFENCE TAKEN, INCLUDING STATEMENT UNDER SECTION 313 CrPC / SECTION 351 BNSS]

**4. Evidence on record.** Prosecution: PW-1 [NAME]; PW-2 [NAME]; [OTHERS]. Documents: Ex. P-1 [DESCRIPTION]; [OTHERS]. Defence evidence: [IF ANY].

**5. Arguments.** [SUBMISSIONS OF BOTH SIDES]

**6. Points for determination.**
(i) [POINT 1]
(ii) [POINT 2]

**7. Appreciation of evidence and findings.** [WITNESS-WISE AND ISSUE-WISE DISCUSSION. NOTE CONTRADICTIONS, DELAY, CHAIN OF CUSTODY, MISSING LINKS, AND LEGAL REQUIREMENTS NOT MET.]

**8. Conclusion.** The prosecution has failed to prove the charge beyond reasonable doubt because [REASONS IN BRIEF]. The accused is entitled to the benefit of doubt.

**ORDER:** The accused [NAME] is **ACQUITTED** of the charge under [SECTIONS AND ACT] under [SECTION 235(1) CrPC / SECTION 258 BNSS]. His bail bonds and surety bonds are cancelled / discharged subject to [SECTION 437A CrPC / SECTION 481 BNSS]. Case property shall be dealt with as follows: [DISPOSAL AFTER APPEAL PERIOD].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_ni_act_138',
    name: 'Section 138 Judgment (Cheque Dishonour, NI Act)',
    group: 'Criminal',
    content: `${header('COMPLAINT CASE NO. [NUMBER] OF [YEAR]')}

${parties('[COMPLAINANT]', 'COMPLAINANT', '[ACCUSED]', 'ACCUSED')}

${dates}

${title('JUDGMENT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881')}

**1. The complaint.** [FACTS: LOAN / LIABILITY, CHEQUE NO. [NUMBER] DATED [DATE] FOR Rs. [AMOUNT], BANK [BANK], PRESENTMENT DATE, DISHONOUR DATE AND REASON.]

**2. Statutory notice and reply.** Demand notice dated [DATE] was served on [DATE]; reply, if any: [SUMMARY]. Complaint filed on [DATE], within limitation.

**3. Plea and evidence.** Notice of accusation under [SECTION 251 CrPC / SECTION 274 BNSS] was explained and the accused pleaded not guilty. Complainant's evidence: CW-1 [NAME]; Ex. C-1 to C-[N] [DOCUMENTS]. Defence: [STATEMENT AND EVIDENCE].

**4. Points for determination.**
(i) Whether the cheque was issued for a legally enforceable debt or liability.
(ii) Whether the cheque was dishonoured and the statutory notice was duly served within time.
(iii) Whether the accused has rebutted the presumption under Sections 118 and 139 of the Act.
(iv) What order should be passed.

**5. Findings.**
**Point (i) and (iii):** [DISCUSSION OF PRESUMPTIONS AND DEFENCE, STANDARD OF PROOF ON THE ACCUSED]
**Point (ii):** [DISCUSSION OF DISHONOUR MEMO, NOTICE, SERVICE AND LIMITATION]

**6. Conclusion and order.** [CONVICTED / ACQUITTED] under Section 138 of the Act. [IF CONVICTED: SENTENCE OF [IMPRISONMENT] AND COMPENSATION OF Rs. [AMOUNT] UNDER [SECTION 357 CrPC / SECTION 395 BNSS] / SECTION 357(3), PAYABLE WITHIN [PERIOD], IN DEFAULT [DEFAULT SENTENCE].]

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_bail_order',
    name: 'Bail Order (Regular / Anticipatory / Interim / Default)',
    group: 'Orders',
    content: `${header('BAIL APPLICATION NO. [NUMBER] OF [YEAR]')}

${parties('[APPLICANT]', 'APPLICANT / ACCUSED', 'STATE OF [STATE]', 'RESPONDENT')}

Crime No. [NUMBER] of [YEAR], Police Station [PS], under [SECTIONS AND ACT]

${title('ORDER ON [REGULAR / ANTICIPATORY / INTERIM / DEFAULT] BAIL APPLICATION UNDER [SECTION 437 / 438 / 439 / 167(2) CrPC / SECTION 480 / 482 / 483 / 187 BNSS]')}

**1. Hearing.** Heard learned counsel for the applicant and learned [PUBLIC PROSECUTOR / COUNSEL FOR COMPLAINANT]. Perused the case diary and the material placed on record.

**2. Case in brief.** [ALLEGATIONS, DATE OF INCIDENT, DATE OF ARREST, PERIOD IN CUSTODY, STATUS OF INVESTIGATION / CHARGE-SHEET]

**3. Submissions.** For the applicant: [GROUNDS]. For the State / complainant: [OBJECTIONS].

**4. Consideration.** [NATURE AND GRAVITY OF OFFENCE, PUNISHMENT PRESCRIBED, PRIMA FACIE MATERIAL, ANTECEDENTS, RISK OF ABSCONDING, TAMPERING WITH EVIDENCE, PERIOD IN CUSTODY, PARITY WITH CO-ACCUSED. REASONS FOR THE CONCLUSION.]

**5. Order.** [APPLICATION IS ALLOWED / REJECTED.] [IF ALLOWED: THE APPLICANT SHALL BE RELEASED ON BAIL ON FURNISHING A PERSONAL BOND OF Rs. [AMOUNT] WITH [NUMBER] SURETY/SURETIES OF THE LIKE AMOUNT, SUBJECT TO THE FOLLOWING CONDITIONS: (a) [CONDITION]; (b) [CONDITION]; (c) [CONDITION].] Observations made are only for deciding this application and shall not affect the trial.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_charge_order',
    name: 'Order on Charge / Discharge (Criminal)',
    group: 'Orders',
    content: `${header('[CASE TYPE] NO. [NUMBER] OF [YEAR]')}

${parties('STATE OF [STATE]', 'PROSECUTION', '[NAME OF ACCUSED]', 'ACCUSED')}

${title('ORDER ON CHARGE')}

**1. Hearing.** Heard learned [PUBLIC PROSECUTOR] and learned counsel for the accused on the question of framing of charge. Perused the police report and documents filed under [SECTION 173 CrPC / SECTION 193 BNSS].

**2. Allegations.** [SUMMARY OF ALLEGATIONS AND THE MATERIAL RELIED ON]

**3. Submissions.** For the prosecution: [SUBMISSIONS]. For the accused: [SUBMISSIONS ON DISCHARGE].

**4. Analysis.** At this stage the Court only has to see whether there is a prima facie case or grave suspicion; it does not weigh the evidence as in a trial. [APPLICATION OF THIS TEST TO EACH OFFENCE, WITH REASONS.]

**5. Order.** [CHARGE UNDER [SECTIONS] BE FRAMED / THE ACCUSED IS DISCHARGED OF THE OFFENCE UNDER [SECTIONS].] [DATE FIXED FOR FRAMING OF CHARGE / EVIDENCE: [DATE].]

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_civil_suit',
    name: 'Civil Suit Judgment (Property / Money Recovery / Contract / Declaration)',
    group: 'Civil',
    content: `${header('CIVIL SUIT NO. [NUMBER] OF [YEAR]')}

${parties('[PLAINTIFF]', 'PLAINTIFF', '[DEFENDANT]', 'DEFENDANT')}

${dates}

${title('JUDGMENT')}

**1. Nature of the suit.** The plaintiff has filed this suit for [RELIEFS CLAIMED] against the defendant[S].

**2. Case of the plaintiff.** [PLAINT AVERMENTS IN BRIEF, IN ORDER]

**3. Case of the defendant.** [WRITTEN STATEMENT, COUNTER-CLAIM IF ANY, IN BRIEF]

**4. Issues framed on [DATE].**
Issue No. 1: [ISSUE] — Onus on [PARTY]
Issue No. 2: [ISSUE] — Onus on [PARTY]
Issue No. 3: [ISSUE] — Onus on [PARTY]
Issue No. [N]: What relief, if any, is the plaintiff entitled to?

**5. Evidence.** Plaintiff: PW-1 [NAME]; Ex. P-1 to P-[N] [DOCUMENTS]. Defendant: DW-1 [NAME]; Ex. D-1 to D-[N] [DOCUMENTS].

**6. Arguments.** [SUBMISSIONS OF BOTH SIDES AND CASE LAW CITED, ONLY IF PROVIDED IN THE PAPERS]

**7. Findings.**
**Issue No. 1:** [DISCUSSION, EVIDENCE, LAW, REASONS] Finding: [IN FAVOUR OF / AGAINST [PARTY]].
**Issue No. 2:** [DISCUSSION AND REASONS] Finding: [...].
**Issue No. 3:** [DISCUSSION AND REASONS] Finding: [...].
**Issue No. [N] (Relief):** [RELIEF GRANTED OR REFUSED, WITH REASONS, INCLUDING COSTS AND INTEREST]

${title('ORDER')}

The suit is [DECREED / DISMISSED] [WITH / WITHOUT COSTS]. [TERMS OF THE DECREE.] Decree be drawn up accordingly. File be consigned to the record room after compliance.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_interim_order',
    name: 'Civil Interim Order (Injunction / Status Quo / Attachment)',
    group: 'Civil',
    content: `${header('[SUIT / CASE] NO. [NUMBER] OF [YEAR]')}
[CENTER]**I.A. NO. [NUMBER] OF [YEAR]**[/CENTER]

${parties('[APPLICANT]', 'APPLICANT', '[RESPONDENT]', 'RESPONDENT')}

${title('ORDER ON APPLICATION UNDER [ORDER AND RULE / SECTION]')}

**1. Hearing.** Heard learned counsel for both sides on the application and perused the record.

**2. The application.** [RELIEF SOUGHT AND GROUNDS IN BRIEF]

**3. Reply and submissions.** [OPPOSITION AND SUBMISSIONS IN BRIEF]

**4. Consideration.** The Court examines (i) whether a prima facie case is made out, (ii) the balance of convenience, and (iii) whether irreparable injury would result if relief is refused. [FINDINGS ON EACH, WITH REASONS.]

**5. Order.** [APPLICATION ALLOWED / DISMISSED.] [TERMS, DURATION AND CONDITIONS OF THE INTERIM RELIEF: TEMPORARY INJUNCTION / STATUS QUO ON [PROPERTY OR POSITION] / ATTACHMENT BEFORE JUDGMENT OF [PROPERTY] / SECURITY TO BE FURNISHED / OTHER INTERIM DIRECTION.] The observations are prima facie and will not influence the final decision. List on [DATE] for [PURPOSE].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_appeal',
    name: 'Civil Appeal Judgment (First / Second Appeal)',
    group: 'Civil',
    content: `${header('[REGULAR CIVIL APPEAL / FIRST APPEAL / SECOND APPEAL] NO. [NUMBER] OF [YEAR]')}

${parties('[APPELLANT]', 'APPELLANT', '[RESPONDENT]', 'RESPONDENT')}

Appeal under [SECTION 96 / SECTION 100 CPC / OTHER PROVISION] against the judgment and [DECREE / ORDER] dated [DATE] passed by [NAME OF TRIAL COURT] in [CASE NO.]

${title('JUDGMENT')}

**1. The appeal.** This appeal is directed against [IMPUGNED JUDGMENT AND OUTCOME BELOW].

**2. Facts in brief.** [BACKGROUND OF THE CASE AND FINDINGS OF THE TRIAL COURT]

**3. Grounds of appeal.** [GROUNDS TAKEN BY THE APPELLANT]

**4. Submissions.** For the appellant: [SUBMISSIONS]. For the respondent: [SUBMISSIONS].

**5. Points for determination.**
(i) [POINT 1; IN A SECOND APPEAL, THE SUBSTANTIAL QUESTION OF LAW]
(ii) [POINT 2]

**6. Analysis.** [RE-APPRECIATION OF THE EVIDENCE AND LAW ON EACH POINT (IN A SECOND APPEAL, ONLY THE SUBSTANTIAL QUESTION OF LAW), WITH REASONS FOR AGREEING OR DISAGREEING WITH THE TRIAL COURT.]

**7. Conclusion and order.** The appeal is [ALLOWED / DISMISSED / PARTLY ALLOWED]. The impugned [JUDGMENT / DECREE / ORDER] is [CONFIRMED / SET ASIDE / MODIFIED AS FOLLOWS: [MODIFICATION]]. [COSTS.] Decree be drawn up. Trial court record be sent back with a copy of this judgment.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_mact',
    name: 'Tribunal Award – Motor Accident Claim (MACT)',
    group: 'Special',
    content: `${header('M.A.C.P. NO. [NUMBER] OF [YEAR]')}

${parties('[CLAIMANT(S)]', 'CLAIMANT(S)', '[DRIVER / OWNER / INSURER]', 'RESPONDENT(S)')}

${dates}

${title('AWARD')}

**1. The claim.** Petition under Section 166 of the Motor Vehicles Act, 1988 for compensation for [DEATH / INJURY] of [NAME], aged [AGE], [OCCUPATION], in a road accident on [DATE] at [PLACE] involving vehicle no. [NUMBER].

**2. Pleadings.** Claimants: [CASE]. Respondents: [DEFENCES, INCLUDING INSURER'S DEFENCES ON LICENCE, PERMIT, POLICY].

**3. Issues.**
Issue 1: Whether the accident occurred due to rash and negligent driving of [VEHICLE / DRIVER].
Issue 2: Whether the claimants are entitled to compensation, and in what amount.
Issue 3: Who is liable to pay it.

**4. Evidence.** Claimants: PW-1 [NAME]; documents [FIR, MLC, POST-MORTEM, INCOME PROOF]. Respondents: [EVIDENCE].

**5. Findings.**
**Issue 1:** [NEGLIGENCE, WITH REASONS]
**Issue 2:** [HEADS OF COMPENSATION WITH CALCULATION: INCOME, DEDUCTION FOR PERSONAL EXPENSES, MULTIPLIER, FUTURE PROSPECTS, CONVENTIONAL HEADS, MEDICAL EXPENSES, PAIN AND SUFFERING.]
**Issue 3:** [LIABILITY OF OWNER AND INSURER, RIGHT OF RECOVERY IF ANY]

Compensation under each head (Rs.):
(a) [HEAD]: [AMOUNT]
(b) [HEAD]: [AMOUNT]
(c) [HEAD]: [AMOUNT]
**Total compensation: Rs. [TOTAL]**

**6. Award.** The claimants are awarded Rs. [TOTAL] with interest at [RATE]% per annum from [DATE] till realisation, payable by [RESPONDENT] within [PERIOD]. Apportionment among claimants and the terms of deposit / investment: [DETAILS].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_family_maintenance',
    name: 'Maintenance Order (Interim / Final)',
    group: 'Family',
    content: `${header('MAINTENANCE CASE NO. [NUMBER] OF [YEAR]')}

${parties('[APPLICANT]', 'APPLICANT', '[RESPONDENT]', 'RESPONDENT')}

${title('ORDER ON APPLICATION FOR MAINTENANCE UNDER [SECTION 125 CrPC / SECTION 144 BNSS]')}

**1. The application.** [RELATIONSHIP OF PARTIES, DATE OF MARRIAGE, DATE OF SEPARATION, REASONS ALLEGED, AMOUNT CLAIMED]

**2. Reply.** [CASE OF THE RESPONDENT, INCLUDING INCOME AND LIABILITIES]

**3. Evidence.** Applicant: [WITNESSES AND DOCUMENTS]. Respondent: [WITNESSES AND DOCUMENTS]. Income and expense affidavits: [IF FILED].

**4. Points for determination.**
(i) Whether the applicant is unable to maintain herself / himself / themselves.
(ii) Whether the respondent has sufficient means and has neglected or refused to maintain.
(iii) What amount of maintenance is payable.

**5. Findings.** [DISCUSSION OF EACH POINT: INCOME OF BOTH PARTIES, STANDARD OF LIVING, DEPENDENTS, NEEDS, AND REASONS FOR THE AMOUNT FIXED.]

**6. Order.** The respondent shall pay monthly maintenance of Rs. [AMOUNT] to [PERSON(S)] from [DATE OF APPLICATION / ORDER], by the [DAY] of each month, [AND Rs. [AMOUNT] LITIGATION EXPENSES]. Arrears of Rs. [AMOUNT] shall be paid in [INSTALMENTS]. Default shall be dealt with as provided by law.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_matrimonial_decree',
    name: 'Family Court Judgment (Divorce / Custody / Guardianship)',
    group: 'Family',
    content: `${header('MATRIMONIAL PETITION NO. [NUMBER] OF [YEAR]')}

${parties('[PETITIONER]', 'PETITIONER', '[RESPONDENT]', 'RESPONDENT')}

${title('JUDGMENT')}

**1. The petition.** Petition under Section [SECTION] of the [HINDU MARRIAGE ACT, 1955 / GUARDIANS AND WARDS ACT, 1890 / HINDU MINORITY AND GUARDIANSHIP ACT, 1956 / OTHER ACT] for [DECREE OF DIVORCE / RESTITUTION / CUSTODY / GUARDIANSHIP / OTHER RELIEF]. Marriage solemnised on [DATE] at [PLACE]; [NUMBER] child(ren) born.

**2. Case of the petitioner.** [GROUNDS IN BRIEF]

**3. Case of the respondent.** [REPLY IN BRIEF]

**4. Mediation / conciliation.** [EFFORTS UNDER THE ACT AND THEIR OUTCOME]

**5. Issues.**
(i) [GROUND ALLEGED, E.G. CRUELTY / DESERTION / MUTUAL CONSENT]
(ii) Whether the petitioner is entitled to the relief claimed.

**6. Evidence and findings.** [EVIDENCE OF BOTH SIDES AND FINDINGS ON EACH ISSUE, WITH REASONS. FOR MUTUAL CONSENT: STATEMENTS OF BOTH PARTIES, COOLING-OFF PERIOD, SETTLEMENT TERMS.]

**7. Custody and guardianship.** [IF CLAIMED: THE WELFARE OF THE CHILD IS THE PARAMOUNT CONSIDERATION. AGE AND WISHES OF THE CHILD, CONDUCT AND MEANS OF EACH PARENT, CHILD'S SCHOOLING AND SETTLED ENVIRONMENT, AND REASONS FOR THE ORDER.]

**8. Ancillary matters.** Custody and visitation: [ORDER]. Permanent alimony / maintenance: [ORDER]. Return of stridhan / articles: [ORDER].

**9. Order.** The petition is [ALLOWED / DISMISSED]. [A DECREE OF [RELIEF] IS PASSED, DISSOLVING THE MARRIAGE SOLEMNISED ON [DATE].] [COSTS.] Decree be drawn up.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_consumer',
    name: 'Tribunal Order – Consumer Commission (Final Order)',
    group: 'Special',
    content: `[CENTER]**[U]BEFORE THE [DISTRICT / STATE] CONSUMER DISPUTES REDRESSAL COMMISSION, [PLACE][/U]**[/CENTER]
[CENTER]**PRESENT: [PRESIDENT / MEMBERS]**[/CENTER]
[CENTER]**CONSUMER COMPLAINT NO. [NUMBER] OF [YEAR]**[/CENTER]

${parties('[COMPLAINANT]', 'COMPLAINANT', '[OPPOSITE PARTY / PARTIES]', 'OPPOSITE PARTY')}

${dates}

${title('FINAL ORDER')}

**1. The complaint.** Filed under Section [35 / 47] of the Consumer Protection Act, 2019, alleging [DEFICIENCY IN SERVICE / DEFECT IN GOODS / UNFAIR TRADE PRACTICE]. [FACTS: PURCHASE / SERVICE, DATE, AMOUNT PAID, GRIEVANCE, NOTICE SENT.]

**2. Version of the opposite party.** [DEFENCE IN BRIEF, INCLUDING OBJECTIONS ON MAINTAINABILITY AND LIMITATION]

**3. Evidence.** Complainant: affidavit and documents Ex. C-1 to C-[N]. Opposite party: affidavit and documents Ex. OP-1 to OP-[N].

**4. Points for determination.**
(i) Whether the complainant is a consumer and the complaint is maintainable and within time.
(ii) Whether there is deficiency in service / defect / unfair trade practice.
(iii) What relief the complainant is entitled to.

**5. Findings.** [DISCUSSION OF EACH POINT WITH REASONS]

**6. Order.** The complaint is [ALLOWED / DISMISSED]. The opposite party shall, within [PERIOD] of this order: (a) [REFUND / REPLACE / REPAIR: Rs. [AMOUNT]] with interest at [RATE]% from [DATE]; (b) pay Rs. [AMOUNT] as compensation for mental agony; (c) pay Rs. [AMOUNT] as costs. Failing which the amount shall carry interest at [RATE]% until payment. Copy of the order be sent to the parties free of cost.

${signature('PRESIDENT / MEMBER')}`,
  },
  {
    id: 'j_writ',
    name: 'Writ Judgment (Constitutional / Administrative Law)',
    group: 'Special',
    content: `[CENTER]**[U]IN THE HIGH COURT OF [STATE / PLACE][/U]**[/CENTER]
[CENTER]**CORAM: [HON'BLE MR. / MRS. JUSTICE [NAME]]**[/CENTER]
[CENTER]**WRIT PETITION ([CIVIL / CRIMINAL]) NO. [NUMBER] OF [YEAR]**[/CENTER]

${parties('[PETITIONER]', 'PETITIONER', '[STATE / RESPONDENTS]', 'RESPONDENTS')}

${title('JUDGMENT')}

**1. The petition.** The petitioner invokes Article [226 / 227] of the Constitution of India seeking [RELIEFS PRAYED].

**2. Facts.** [FACTUAL BACKGROUND IN ORDER, WITH DATES AND IMPUGNED ORDER / ACTION]

**3. Submissions.** For the petitioner: [SUBMISSIONS]. For the respondents: [SUBMISSIONS AND PRELIMINARY OBJECTIONS].

**4. Questions for consideration.**
(i) [QUESTION OF LAW OR FACT 1]
(ii) [QUESTION 2]

**5. Analysis.** [LEGAL POSITION AND PRECEDENTS FROM THE PAPERS, THEIR APPLICATION TO THE FACTS, AND REASONS ON EACH QUESTION. NOTE MAINTAINABILITY, ALTERNATIVE REMEDY AND SCOPE OF JUDICIAL REVIEW.]

**6. Conclusion and directions.** The writ petition is [ALLOWED / DISMISSED / DISPOSED OF]. [DIRECTIONS TO THE RESPONDENTS, TIME-LIMIT FOR COMPLIANCE, LIBERTY GRANTED, COSTS.] Pending applications, if any, stand closed.

[ROW]
Place: [PLACE]
Date: [DATE]
|
**([NAME])**
JUDGE
[/ROW]`,
  },
  {
    id: 'j_criminal_appeal',
    name: 'Criminal Appeal Judgment (Conviction / Acquittal / Sentence)',
    group: 'Criminal',
    content: `${header('CRIMINAL APPEAL NO. [NUMBER] OF [YEAR]')}

${parties('[APPELLANT]', 'APPELLANT', '[STATE OF [STATE] / RESPONDENT]', 'RESPONDENT')}

Appeal under [SECTION 374 / 372 / 378 CrPC / SECTION 415 / 413 / 419 BNSS] against the judgment dated [DATE] [OF CONVICTION / OF ACQUITTAL / ON SENTENCE] passed by [NAME OF TRIAL COURT] in [CASE NO.]

${title('JUDGMENT')}

**1. The appeal.** This appeal challenges [THE CONVICTION UNDER [SECTIONS] AND SENTENCE OF [SENTENCE] / THE ACQUITTAL OF THE ACCUSED / THE ADEQUACY OR LEGALITY OF THE SENTENCE].

**2. Facts and the judgment under appeal.** [PROSECUTION CASE, TRIAL COURT FINDINGS AND REASONS IN BRIEF]

**3. Grounds of appeal.** [GROUNDS TAKEN]

**4. Submissions.** For the appellant: [SUBMISSIONS]. For the respondent: [SUBMISSIONS].

**5. Points for determination.**
(i) Whether the trial court's appreciation of the evidence is correct, or is perverse or contrary to the record.
(ii) Whether the ingredients of the offence are proved beyond reasonable doubt.
(iii) Whether the sentence imposed is just, or calls for interference.

**6. Re-appreciation of evidence and analysis.** [THE APPELLATE COURT RE-EXAMINES THE EVIDENCE. IN AN APPEAL AGAINST ACQUITTAL, A VIEW TAKEN BY THE TRIAL COURT IS INTERFERED WITH ONLY WHERE IT IS PERVERSE OR IMPOSSIBLE. WITNESS-WISE AND POINT-WISE REASONS.]

**7. Conclusion and order.** The appeal is [ALLOWED / DISMISSED / PARTLY ALLOWED]. The conviction and sentence are [CONFIRMED / SET ASIDE / ALTERED AS FOLLOWS: [MODIFICATION]]. [IF SENTENCE SUSPENDED OR APPELLANT ON BAIL: BAIL BONDS ARE CANCELLED AND THE APPELLANT SHALL SURRENDER ON [DATE] TO SERVE THE REMAINING SENTENCE.] Fine, if paid, shall be [REFUNDED / ADJUSTED]. Trial court record be returned with a copy of this judgment.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_sentencing',
    name: 'Sentencing Order (After Criminal Conviction)',
    group: 'Criminal',
    content: `${header('SESSIONS CASE / CRIMINAL CASE NO. [NUMBER] OF [YEAR]')}

${parties('STATE OF [STATE]', 'PROSECUTION', '[NAME OF CONVICT]', 'CONVICT')}

${title('ORDER ON SENTENCE')}

**1. Background.** The convict was found guilty and convicted under [SECTIONS AND ACT] by judgment dated [DATE]. The convict was heard on the question of sentence under [SECTION 235(2) CrPC / SECTION 258(2) BNSS] on [DATE].

**2. Submissions on sentence.** For the convict: [AGE, FAMILY BACKGROUND, DEPENDENTS, OCCUPATION, FIRST OFFENDER OR NOT, CONDUCT IN CUSTODY, REMORSE]. For the prosecution / victim: [NATURE AND IMPACT OF OFFENCE, ANTECEDENTS, SOCIETAL INTEREST].

**3. Punishment prescribed.** The offence under [SECTION] is punishable with [MINIMUM AND MAXIMUM PUNISHMENT].

**4. Aggravating and mitigating circumstances.**
Aggravating: [CIRCUMSTANCES FROM THE RECORD]
Mitigating: [CIRCUMSTANCES FROM THE RECORD]

**5. Consideration.** [WEIGHING THE CIRCUMSTANCES, PROPORTIONALITY, DETERRENCE AND REFORM; WHETHER RELEASE ON PROBATION OF GOOD CONDUCT OR ADMONITION UNDER THE PROBATION OF OFFENDERS ACT / [SECTION 360 CrPC / SECTION 401 BNSS] IS OR IS NOT APPROPRIATE, WITH REASONS.]

**6. Sentence and order.**
(a) The convict is sentenced to [IMPRISONMENT] for the offence under [SECTION], and to a fine of Rs. [AMOUNT], in default [DEFAULT SENTENCE].
(b) [SENTENCES TO RUN CONCURRENTLY / CONSECUTIVELY.]
(c) The period already spent in custody from [DATE] to [DATE] shall be set off under [SECTION 428 CrPC / SECTION 468 BNSS].
(d) Compensation to the victim of Rs. [AMOUNT] under [SECTION 357 / 357A CrPC / SECTION 395 / 396 BNSS], if any.
(e) Case property shall be [DISPOSAL AFTER APPEAL PERIOD].
(f) A free copy of the judgment and this order be given to the convict.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_criminal_application',
    name: 'Criminal Application Order (Discharge / Summoning / Remand etc.)',
    group: 'Orders',
    content: `${header('CRIMINAL MISC. APPLICATION NO. [NUMBER] OF [YEAR]')}

${parties('[APPLICANT]', 'APPLICANT', '[RESPONDENT / STATE OF [STATE]]', 'RESPONDENT')}

Arising out of [CASE / CRIME NO.], Police Station [PS], under [SECTIONS AND ACT]

${title('ORDER ON APPLICATION UNDER [SECTION AND ACT]')}

**1. Nature of the application.** [APPLICATION FOR DISCHARGE / SUMMONING OF ADDITIONAL ACCUSED OR WITNESS / POLICE OR JUDICIAL REMAND / RETURN OR RELEASE OF PROPERTY / OTHER RELIEF, AND THE RELIEF SOUGHT]

**2. Hearing.** Heard learned counsel for the applicant and learned [PUBLIC PROSECUTOR / COUNSEL FOR THE RESPONDENT]. Perused the record and the case diary.

**3. Case in brief.** [RELEVANT BACKGROUND, STAGE OF THE CASE AND MATERIAL ON RECORD]

**4. Submissions.** For the applicant: [GROUNDS]. For the respondent: [OBJECTIONS].

**5. Consideration.** [THE LEGAL TEST FOR THE ORDER SOUGHT AND ITS APPLICATION TO THE RECORD, WITH REASONS. FOR REMAND: GROUNDS FOR ARREST, PERIOD ALREADY IN CUSTODY AND NEED FOR FURTHER CUSTODY. FOR SUMMONING: WHETHER SUFFICIENT EVIDENCE EXISTS AGAINST THE PERSON. FOR DISCHARGE: WHETHER A PRIMA FACIE CASE EXISTS.]

**6. Order.** The application is [ALLOWED / REJECTED / DISPOSED OF]. [OPERATIVE DIRECTIONS: [REMAND TILL [DATE] / PERSON TO BE SUMMONED FOR [DATE] / ACCUSED DISCHARGED OF [OFFENCE] / PROPERTY RELEASED ON [CONDITIONS]].] List on [DATE] for [PURPOSE].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_review_revision',
    name: 'Review / Revision Judgment',
    group: 'Civil',
    content: `${header('[REVIEW PETITION / CIVIL REVISION / CRIMINAL REVISION] NO. [NUMBER] OF [YEAR]')}

${parties('[PETITIONER / APPLICANT]', 'PETITIONER', '[RESPONDENT]', 'RESPONDENT')}

Arising out of the [ORDER / JUDGMENT / DECREE] dated [DATE] in [CASE NO.] passed by [NAME OF COURT]

${title('JUDGMENT')}

**1. The petition.** The petitioner seeks [REVIEW OF THE ORDER UNDER [ORDER 47 RULE 1 / SECTION 114 CPC / OTHER PROVISION] / REVISION UNDER [SECTION 115 CPC / SECTION 397 / 401 CrPC / SECTION 438 / 442 BNSS]] of the [ORDER / JUDGMENT] dated [DATE].

**2. Background.** [FACTS AND THE ORDER UNDER CHALLENGE, WITH THE REASONS GIVEN]

**3. Grounds.** [GROUNDS FOR REVIEW (NEW AND IMPORTANT MATTER OR EVIDENCE NOT AVAILABLE EARLIER, MISTAKE OR ERROR APPARENT ON THE FACE OF THE RECORD, OR ANY OTHER SUFFICIENT REASON) / GROUNDS FOR REVISION (ILLEGALITY, IRREGULARITY, IMPROPRIETY OR JURISDICTIONAL ERROR)]

**4. Submissions.** For the petitioner: [SUBMISSIONS]. For the respondent: [SUBMISSIONS ON MAINTAINABILITY AND MERITS].

**5. Scope of jurisdiction.** [THE LIMITED SCOPE OF REVIEW OR REVISION: IT IS NOT AN APPEAL IN DISGUISE AND THE COURT DOES NOT RE-APPRECIATE EVIDENCE AS A COURT OF APPEAL.]

**6. Analysis.** [WHETHER THE ALLEGED ERROR, NEW MATERIAL OR ILLEGALITY IS MADE OUT, WITH REASONS ON EACH GROUND.]

**7. Order.** The [REVIEW PETITION / REVISION] is [ALLOWED / DISMISSED]. [IF ALLOWED: THE ORDER DATED [DATE] IS [RECALLED / SET ASIDE / MODIFIED AS FOLLOWS: [TERMS]], AND THE MATTER IS [REMANDED / LISTED] ON [DATE].] [COSTS.] Record be returned to the court below with a copy of this judgment.

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_execution',
    name: 'Execution Order (Decrees, Awards and Court Orders)',
    group: 'Civil',
    content: `${header('EXECUTION CASE NO. [NUMBER] OF [YEAR]')}

${parties('[DECREE-HOLDER / AWARD-HOLDER]', 'DECREE-HOLDER', '[JUDGMENT-DEBTOR]', 'JUDGMENT-DEBTOR')}

${title('ORDER IN EXECUTION')}

**1. The decree sought to be executed.** [DECREE / AWARD / ORDER] dated [DATE] passed in [CASE NO.] by [COURT], for [SUBSTANCE OF THE RELIEF AND AMOUNT], with interest and costs as awarded. Execution filed on [DATE] under [ORDER 21 CPC / SECTION 36 OF THE ARBITRATION AND CONCILIATION ACT, 1996 / OTHER PROVISION].

**2. Status of the decree.** [WHETHER THE DECREE IS FINAL, ANY APPEAL OR STAY, LIMITATION FOR EXECUTION, AMOUNT ALREADY RECOVERED, AMOUNT OUTSTANDING]

**3. Objections of the judgment-debtor.** [OBJECTIONS, INCLUDING ANY UNDER SECTION 47 CPC: NULLITY, SATISFACTION, LIMITATION, OR INEXECUTABILITY]

**4. Submissions.** For the decree-holder: [SUBMISSIONS AND MODE OF EXECUTION SOUGHT]. For the judgment-debtor: [SUBMISSIONS].

**5. Consideration.** [WHETHER THE OBJECTIONS ARE SUSTAINABLE (AN EXECUTING COURT CANNOT GO BEHIND THE DECREE), THE AMOUNT DUE, AND THE MOST SUITABLE MODE OF EXECUTION, WITH REASONS.]

**6. Order.** The objections are [OVERRULED / UPHELD]. The decree is to be executed by [ATTACHMENT AND SALE OF [PROPERTY] / ATTACHMENT OF BANK ACCOUNT OR SALARY / DELIVERY OF POSSESSION OF [PROPERTY] / ARREST AND DETENTION / OTHER MODE]. [WARRANT / PROCLAMATION / NOTICE TO ISSUE]. The judgment-debtor shall pay Rs. [AMOUNT] within [PERIOD]. List on [DATE] for [REPORT / COMPLIANCE].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_settlement',
    name: 'Settlement / Compromise Order (Consent Decree / Compounding)',
    group: 'Orders',
    content: `${header('[CASE TYPE] NO. [NUMBER] OF [YEAR]')}

${parties('[PARTY 1]', '[DESIGNATION]', '[PARTY 2]', '[DESIGNATION]')}

${title('ORDER RECORDING SETTLEMENT / COMPROMISE')}

**1. The settlement.** The parties, assisted by their counsel, have filed a [COMPROMISE PETITION / SETTLEMENT DEED / JOINT MEMO] dated [DATE] under [ORDER 23 RULE 3 CPC / SECTION 320 CrPC / SECTION 359 BNSS / SECTION 147 OF THE NEGOTIABLE INSTRUMENTS ACT / OTHER PROVISION].

**2. Verification.** The parties were present [IN PERSON / THROUGH VIDEO LINK] and were identified by their counsel. Each of them stated on [oath / affirmation] that the settlement is voluntary, free from coercion or undue influence, and understood by them.

**3. Terms of the settlement.**
(a) [TERM 1: PAYMENT / TRANSFER / UNDERTAKING, WITH AMOUNT AND DATE]
(b) [TERM 2]
(c) [TERM 3: WITHDRAWAL OF OTHER PROCEEDINGS, IF ANY]

**4. Consideration.** [THE COURT IS SATISFIED THAT THE SETTLEMENT IS LAWFUL AND NOT AGAINST PUBLIC POLICY; WHERE THE LAW PERMITS COMPOUNDING OF THE OFFENCE OR A CONSENT DECREE; WHETHER PERMISSION OF THE COURT IS REQUIRED; AND, IN CRIMINAL MATTERS, THAT THE VICTIM / COMPLAINANT CONSENTS.]

**5. Order.** The settlement is accepted and recorded. [IN A CIVIL MATTER: THE SUIT IS DECREED IN TERMS OF THE COMPROMISE AND THE DECREE SHALL FORM PART OF THIS ORDER. / IN A CRIMINAL MATTER: THE OFFENCE IS COMPOUNDED AND THE ACCUSED IS [ACQUITTED / DISCHARGED] UNDER [PROVISION].] The parties shall abide by the terms of the settlement. [COURT FEE REFUND, IF ANY.] The case is [DISPOSED OF / CONSIGNED TO RECORD].

${signature('[DESIGNATION]')}`,
  },
  {
    id: 'j_tribunal',
    name: 'Tribunal Award / Decision (Labour / Tax / Other Tribunals)',
    group: 'Special',
    content: `[CENTER]**[U]BEFORE THE [NAME OF TRIBUNAL / LABOUR COURT / INDUSTRIAL TRIBUNAL / APPELLATE TRIBUNAL], [PLACE][/U]**[/CENTER]
[CENTER]**PRESENT: [PRESIDING OFFICER / MEMBERS]**[/CENTER]
[CENTER]**[CASE TYPE: REFERENCE / APPEAL / APPLICATION] NO. [NUMBER] OF [YEAR]**[/CENTER]

${parties('[APPLICANT / APPELLANT / WORKMAN]', '[DESIGNATION]', '[RESPONDENT / MANAGEMENT / DEPARTMENT]', '[DESIGNATION]')}

${dates}

${title('AWARD / ORDER')}

**1. Reference and jurisdiction.** [HOW THE MATTER CAME BEFORE THE TRIBUNAL: TERMS OF REFERENCE UNDER THE ACT, OR THE ORDER APPEALED AGAINST, WITH THE STATUTORY PROVISION AND TIME LIMIT.]

**2. Case of the [APPLICANT / APPELLANT / WORKMAN].** [CLAIM AND GROUNDS IN BRIEF]

**3. Case of the [RESPONDENT / MANAGEMENT / DEPARTMENT].** [DEFENCE AND PRELIMINARY OBJECTIONS IN BRIEF]

**4. Issues.**
Issue 1: [WHETHER THE TRIBUNAL HAS JURISDICTION AND THE CLAIM IS WITHIN TIME]
Issue 2: [ISSUE ON THE MERITS]
Issue 3: [ISSUE ON THE MERITS]
Issue 4: What relief, if any, is the [APPLICANT / APPELLANT / WORKMAN] entitled to?

**5. Evidence.** [WITNESSES, AFFIDAVITS AND DOCUMENTS WITH EXHIBIT MARKS FOR EACH SIDE]

**6. Findings.** [ISSUE-WISE DISCUSSION OF THE EVIDENCE AND LAW, WITH REASONS. FOR A LABOUR MATTER: EMPLOYMENT, TERMINATION OR RETRENCHMENT, PROCEDURE FOLLOWED, PROPORTIONALITY OF PUNISHMENT. FOR A TAX MATTER: THE ASSESSMENT OR ORDER, THE STATUTORY PROVISION AND THE QUESTION OF LAW OR FACT.]

**7. Award / order.** [THE CLAIM IS ALLOWED / REJECTED / PARTLY ALLOWED.] [RELIEF: REINSTATEMENT, BACK WAGES, COMPENSATION, SET ASIDE OR CONFIRMED ASSESSMENT, REFUND, WITH AMOUNTS AND DATES AND INTEREST AT [RATE]%.] The award shall be given effect within [PERIOD]. [COSTS.]

${signature('PRESIDING OFFICER / MEMBER')}`,
  },
  {
    id: 'j_arbitration',
    name: 'Arbitration-Related Order (Interim Measures / Challenge / Enforcement)',
    group: 'Special',
    content: `${header('[ARBITRATION PETITION / ARBITRATION APPEAL / EXECUTION PETITION] NO. [NUMBER] OF [YEAR]')}

${parties('[PETITIONER / APPLICANT]', '[DESIGNATION]', '[RESPONDENT]', '[DESIGNATION]')}

${title('ORDER UNDER SECTION [9 / 17 / 34 / 36 / 37 / OTHER SECTION] OF THE ARBITRATION AND CONCILIATION ACT, 1996')}

**1. The petition.** The petitioner seeks [INTERIM MEASURES OF PROTECTION / SETTING ASIDE OF THE ARBITRAL AWARD / ENFORCEMENT OF THE ARBITRAL AWARD / OTHER RELIEF] in respect of the arbitration agreement dated [DATE] contained in [CONTRACT / CLAUSE NO.].

**2. Background.** [PARTIES' DISPUTE, DATE OF INVOCATION OF ARBITRATION, CONSTITUTION OF THE TRIBUNAL, AND, WHERE RELEVANT, THE AWARD DATED [DATE] AND ITS OPERATIVE TERMS.]

**3. Submissions.** For the petitioner: [SUBMISSIONS]. For the respondent: [SUBMISSIONS AND PRELIMINARY OBJECTIONS, INCLUDING LIMITATION AND JURISDICTION].

**4. Questions for consideration.**
(i) [MAINTAINABILITY, LIMITATION AND EXISTENCE OF A VALID ARBITRATION AGREEMENT]
(ii) [FOR INTERIM MEASURES: PRIMA FACIE CASE, BALANCE OF CONVENIENCE AND IRREPARABLE HARM / FOR A CHALLENGE: WHETHER ANY GROUND UNDER SECTION 34(2) OR 34(2A) IS MADE OUT / FOR ENFORCEMENT: WHETHER THE AWARD IS ENFORCEABLE AS A DECREE]
(iii) [WHAT RELIEF SHOULD BE GRANTED]

**5. Analysis.** [LIMITED SCOPE OF COURT INTERVENTION IN ARBITRAL MATTERS; THE COURT DOES NOT SIT IN APPEAL OVER THE AWARD ON MERITS. APPLICATION OF THE LAW TO THE RECORD ON EACH QUESTION, WITH REASONS.]

**6. Order.** The [PETITION / APPEAL] is [ALLOWED / DISMISSED / DISPOSED OF]. [OPERATIVE DIRECTIONS: INTERIM MEASURE AND ITS DURATION AND CONDITIONS / AWARD SET ASIDE IN PART OR WHOLE / AWARD ENFORCEABLE AS A DECREE, WITH AMOUNT AND INTEREST.] [COSTS.] List on [DATE] for [PURPOSE].

${signature('[DESIGNATION]')}`,
  },
];

const GROUP_ORDER: JudgementTemplateOption['group'][] = ['Criminal', 'Civil', 'Family', 'Special', 'Orders'];

/** Menu order: grouped by court side, original order kept inside each group. */
export const JUDGEMENT_TEMPLATE_OPTIONS: JudgementTemplateOption[] = JUDGEMENT_TEMPLATE_LIST
  .map(({ id, name, group }, index) => ({ id, name, group, index }))
  .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.index - b.index)
  .map(({ id, name, group }) => ({ id, name, group }));

export const JUDGEMENT_TEMPLATES: Record<string, string> = Object.fromEntries(
  JUDGEMENT_TEMPLATE_LIST.map((t) => [t.id, t.content])
);
