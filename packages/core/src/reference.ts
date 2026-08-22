/**
 * Reference material carried through from the source documents.
 *
 * Two sheets of the Indicator Data Dictionary are not indicator rows but are
 * still part of the specification: the Notes sheet, which states the rules the
 * engine has to obey, and the Working Defaults sheet, which states what to
 * assume for the five open items until a pilot home says otherwise.
 *
 * They live here, beside the dictionary, because a rule that is only written
 * in a spreadsheet on someone's laptop is a rule the product will drift away
 * from. Text is verbatim; only the structure is ours.
 */

export interface SourceNote {
  id: string;
  heading: string;
  body: string;
}

/** The Notes sheet, in the order it is written. */
export const SOURCE_NOTES: readonly SourceNote[] = [
  {
    id: 'purpose',
    heading: 'Purpose',
    body: "Data dictionary for the Quality Trend Tracker's first 15 indicators, handed off to the tech team alongside the product specification, dashboard wireframe, testing pack and clickable prototype.",
  },
  {
    id: 'missing-data',
    heading: 'Standard missing-data rule',
    body: "If the numerator or denominator is missing or not submitted for the period, do not calculate a value. Mark the indicator as 'insufficient data' for that period. Never impute zero or carry forward the previous value. This applies to every indicator unless a row states otherwise (see Q13).",
  },
  {
    id: 'data-sources',
    heading: 'Data sources',
    body: 'Source systems listed per indicator are placeholders based on typical care home systems. Confirm actual source system names per pilot care home before finalising ingestion mapping.',
  },
  {
    id: 'direction-of-harm',
    heading: 'Direction of harm',
    body: 'Recorded so the trend engine knows which direction of movement counts as deterioration versus improvement per indicator — this cannot be assumed to be uniform across indicators (see Q13, where lower is worse).',
  },
  {
    id: 'denominators',
    heading: 'Denominators',
    body: "Resident-days and scheduled hours are the two recurring denominators. Both must be sourced consistently (same occupancy/rota data feeding every indicator that uses them) or rates across indicators won't be comparable.",
  },
  {
    id: 'open-items',
    heading: 'Open items before build',
    body: 'Confirm required-training list versioning (Q07), supervision interval by role (Q08), finding-area taxonomy (Q10), complaint theme list (Q12), and satisfaction survey instrument (Q13) with a pilot care home before finalising calculation logic.',
  },
  {
    id: 'period',
    heading: 'Period definition',
    body: "A 'period' is a calendar month (1st to last day), unless a pilot home's existing reporting cycle differs — in which case the home states its period start/end dates in the data template rather than the system assuming calendar-month boundaries. Every indicator for a given home must use the same period boundaries so trends line up.",
  },
  {
    id: 'cadence',
    heading: 'Reporting cadence',
    body: "Default: all 15 indicators report monthly. Q06 (turnover), Q10 (recurring findings), Q13 (satisfaction) and Q15 (regulatory) may report quarterly instead, per home, if that matches how the home already collects them. If an indicator is due monthly and a home submits nothing for a given month, that month is 'insufficient data' for that indicator (per the standard missing-data rule) — the trend engine does not interpolate or wait for a late submission before evaluating other indicators.",
  },
];

export interface WorkingDefault {
  /** The indicator whose open item this settles, provisionally. */
  indicatorId: string;
  item: string;
  /** What the search actually established, including where it found nothing. */
  finding: string;
  /** What to assume until a pilot home says otherwise. */
  proposed: string;
  sources: readonly { label: string; url: string }[];
}

/**
 * The Working Defaults sheet.
 *
 * The sheet is explicit that these are fallbacks to use ONLY if pilot manager
 * conversations have not happened, so nothing here is wired into calculation
 * logic. They are surfaced, sourced and marked provisional so the decision is
 * taken deliberately rather than inherited by accident.
 */
export const WORKING_DEFAULTS: readonly WorkingDefault[] = [
  {
    indicatorId: 'Q07',
    item: 'Required training list',
    finding:
      'CQC does not publish a fixed mandatory training list. Regulation 18 requires providers to decide training appropriate to their service and staff roles. One specific item IS a confirmed legal requirement for every CQC-registered provider: training on learning disability and autism (Oliver McGowan Mandatory Training), required under the Health and Care Act 2022, Code of Practice in force since 6 September 2025.',
    proposed:
      "Build the list per role using Regulation 18 as the legal basis, with Oliver McGowan training as a confirmed fixed entry, and the rest (safeguarding, moving & handling, fire safety, infection control, first aid, medication, dementia awareness) as a sector-common starting set to confirm against the pilot home's actual matrix — these are not individually mandated in law the way Oliver McGowan is.",
    sources: [
      {
        label: 'CQC Regulation 18: Staffing (official)',
        url: 'https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-18',
      },
      {
        label: 'Statutory text, Regulation 18(2)(a) (legislation.gov.uk)',
        url: 'https://legislation.gov.uk/ukdsi/2014/9780111117613/regulation/18',
      },
      {
        label: 'Oliver McGowan Mandatory Training — legal basis (Skills for Care)',
        url: 'https://www.skillsforcare.org.uk/Funding/Oliver-McGowan-Mandatory-Training.aspx',
      },
    ],
  },
  {
    indicatorId: 'Q08',
    item: 'Supervision interval',
    finding:
      'CORRECTED: an earlier version of this sheet cited NICE NG21, which is guidance for domiciliary/home care workers supporting people in their own homes — it does not cover residential care home staff, and citing it here was a mismatch. For residential care home staff the relevant reference is Skills for Care’s own supervision guidance, which points to a common practice of every 6-8 weeks, and Regulation 18 itself, which requires supervision but sets no fixed interval; providers decide their own policy.',
    proposed:
      "Every 6-8 weeks for confirmed staff, monthly during probation. This is a policy choice grounded in the most-cited sector practice, not a legal minimum — flag it as changeable against the pilot home's own policy.",
    sources: [
      {
        label: 'Skills for Care — Effective supervision guide (PDF, official)',
        url: 'https://www.skillsforcare.org.uk/resources/documents/Support-for-leaders-and-managers/Managing-people/Supervision/Effective-supervision-guide.pdf',
      },
      {
        label: 'CQC Regulation 18: Staffing (supervision required, no fixed interval)',
        url: 'https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-18',
      },
      {
        label: 'NICE NG21 — home/domiciliary care only, NOT residential care homes (does not apply to Q08)',
        url: 'https://www.nice.org.uk/guidance/ng21/chapter/recommendations',
      },
    ],
  },
  {
    indicatorId: 'Q10',
    item: 'Recurring audit finding taxonomy',
    finding:
      "CQC's five Key Lines of Enquiry (Safe, Effective, Caring, Responsive, Well-led) are confirmed as the official regulatory domain structure used in adult social care inspections.",
    proposed:
      'Tag every finding with one of the five KLOEs plus a free-text sub-theme; match recurrence on domain + sub-theme rather than exact wording.',
    sources: [
      {
        label: 'CQC — Key lines of enquiry for adult social care services (official)',
        url: 'https://www.cqc.org.uk/guidance-providers/adult-social-care/key-lines-enquiry-adult-social-care-services',
      },
      {
        label: 'CQC — The 5 key questions we ask (official, plain summary)',
        url: 'https://www.cqc.org.uk/about-us/how-we-do-our-job/the-5-key-questions-we-ask',
      },
    ],
  },
  {
    indicatorId: 'Q12',
    item: 'Complaint theme taxonomy',
    finding:
      'Confirmed: CQC Regulation 16 requires providers to have an effective complaints system but does not specify complaint categories or themes — no official taxonomy exists to adopt. The proposed 8-theme list remains a sector-convention default, not a sourced standard.',
    proposed:
      'Care/support delivery, staff attitude & communication, meals & nutrition, environment & cleanliness, medication, activities & engagement, admission/discharge, financial/billing — confirm against how the pilot home already tags complaints, if at all.',
    sources: [
      {
        label: 'CQC Regulation 16: Receiving and acting on complaints (confirms no category list exists)',
        url: 'https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-16',
      },
    ],
  },
  {
    indicatorId: 'Q13',
    item: 'Satisfaction survey instrument',
    finding:
      'Confirmed directly from the NIHR-funded DACHA study (the national project building a minimum data set for care homes): there is no UK or international consensus on a standardised quality-of-life/satisfaction measure for care home residents, unlike the consensus that exists for clinical health measures. The closest thing to a recognised research tool is ASCOT (Adult Social Care Outcomes Toolkit, PSSRU), used in DACHA’s own pilot alongside ICECAP-O and EQ-5D-5L — but these are research/commissioning instruments, not something homes typically run as a routine monthly operational survey.',
    proposed:
      "Don't adopt a 'validated' instrument, since none is the operational norm. Use a short in-house 5-point scale across 5-7 domains matching common commercial platforms, but check what the pilot home already runs before building anything new; if they use something you can simply receive, prefer theirs.",
    sources: [
      {
        label: 'DACHA study — national consultation confirming no UK consensus (NIHR Journals Library)',
        url: 'https://www.journalslibrary.nihr.ac.uk/hsdr/published-articles/NPYT7562',
      },
      {
        label: 'DACHA pilot — ASCOT/ICECAP-O/EQ-5D-5L as research instruments used (Health & QoL Outcomes)',
        url: 'https://link.springer.com/article/10.1186/s12955-025-02356-0',
      },
    ],
  },
];

/**
 * How the dictionary's `type` field is used, and — just as importantly — how
 * it is not. A lagging indicator describes an outcome that has already become
 * visible; treating one as an early warning is the commonest way a tracker
 * like this misleads the person reading it.
 */
export const LEADING_LAGGING_NOTE =
  "The dictionary's Type field is used exactly as supplied. Indicators are never relabelled on opinion. Potential leading indicators are used to identify developing organisational conditions; lagging indicators describe outcomes that have already become visible. Lagging measures stay in view because they provide learning, accountability and context — but an incident rate on its own is never treated as a prediction of a future incident.";
