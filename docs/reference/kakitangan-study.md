# Kakitangan.com — Study of Interact's Current Setup

**Studied:** 2026-11-15 by the Delivery Lead, read-only, in Albert's signed-in Chrome session.
**Purpose:** model and benchmark for PRET Phase 1 (and Phase 2 payroll).
**PDPA:** configuration and field *labels* only. No employee personal values (names, NRIC,
bank, salary, family) are recorded here.

Kakitangan modules visible: Dashboard, Users, Leave, Benefits, Insurance, Investment,
Payroll, Claims, Hadir (attendance). Interact's account: 5 active employees, 1 location
(Selangor), departments Management / Development / Administration, employee numbers `INT-nnn`.

---

## 1. Employee master (Users)

**Employee list columns:** Employee No. · Name · Position · Account Status · Department ·
Reporting To · Location · Groups (tags, e.g. Everyone / Male / Female). Tabs: Manage Team,
Terminated Employees, Groups, Staff Reports, Org Chart, Appraisal. Actions: Export Team
Data, Add Single Employee, Batch Add Employees, Batch Update Employees. Sub-tab "Pending
Activation" (invited but not signed in).

**Add New Employee (minimum form):** Official Full Name*, Preferred Name*, Gender*, Email*
(login ID; "No Email" option), Phone, Date of Birth · Employee Number, Start Date*,
Reports To*, Position*, Department*, Subsidiary, Location*, Employment Type* · opening
**leave taken** (Annual*, Sick*, Hospitalisation*) · **carry-forward balance remaining*** ·
Send invitation email (y/n).

**Profile card (left):** photo, name, employee no., position, location, account status,
length of service ("4 years 1 month 14 days"), email, phone, department, reporting-to
(since date), **Activity Log**, **Notes**, **Training & Cert**. **Actions** menu.

**Profile tabs and fields:**

| Tab | Section | Fields |
|-----|---------|--------|
| General | Email | Email (login) |
| | Personal info | Official Full Name, Preferred Name, Phone, Gender, Date of Birth, Race, Religion, Passport No., NRIC No., Highest Qualification, Nationality, Permanent Resident, Marital Status |
| | Permanent address | Address, City, Postcode, Region (state), Country |
| | Correspondence address | Address, City, Postcode, Region, Country |
| | Emergency contact | Full Name, Phone, Relationship |
| Employment | Employment information | Employee No., Duration of Service (derived), Work Permit No. / Expiry, Pay Group, Location, Employment Status (e.g. "Active - Confirmed") + Effective From / To, Date of Confirmation, Employment Type, Position, Position Level (grade), Department, Functional Group, Subsidiary, Cost Center, Reports To + since date, Returning Expert Program (y/n), Knowledge Worker at Specified Region (y/n), Join Date, Contract/LOA signed date, Date of Retirement / End of Contract, Notice Period (days) |
| | Organisational history | Effective-dated job records in the company (Add History) |
| | Career progression | Past jobs before joining |
| Compensation *(Phase 2 payroll)* | Bank details | Bank Name, Bank Account Type, Bank Account No., ASNB Account No. |
| | Compensation details | Effective Date, Salary Type / Pay Interval, Payment Method, Salary, Reason + **History** |
| | Income tax (PCB) | Pay Tax, Tax Borne by Employer, Spouse is Working, Spouse is Disabled, Income Tax No., Malaysian Tax Resident, Disabled Person, LHDNM State (branch), Children <18, Children in tertiary education >18, Disabled children <18, Disabled children in tertiary education, Deductible Child Relief Point |
| | EPF | Pay EPF, EPF Borne by Employer, EPF Account No., Employee EPF Rate, Extra Employee EPF %, Extra Employer EPF % |
| | SOCSO | Pay SOCSO, SOCSO Borne by Employer, Pay SKBBK, SKBBK Borne by Employer, SOCSO Account No., Has contributed to SOCSO before |
| | EIS | EIS Borne by Employer |
| | Zakat | Pay Zakat (amount), Zakat Account No. |
| | HRDF | Pay HRDF |
| | PTPTN | Monthly deduction, Start date, End date |
| Leave | Entitlements | Per leave type: "x out of y available" + Settings (per-employee override); Carry-forward balance; Set maximum carry-forward; Update Entitlement |
| Family | Family members | Relationship, Name, Birthday, Nationality, Phone, NRIC (list, add) |
| | Next of kin | Full Name, Phone, Relationship |
| Documents | Employee documents; **Company assets** (equipment issued) | |
| Appraisal | (Talenta integration) | |

**Company Settings → Other Details:** birthday visibility, **allow employees to edit
their personal information**, contact visibility (within department), org chart, multiple
companies (single login).

**Company Settings → Basic Details:** Logo, Name, Registration Number, Locations, Primary
Address, Primary Phone, **Working Days** (Mon–Sun each Full / Half / Off day; advanced
per-group working days), "Public holidays are off days". Other sections: Bank Account
Details, 2FA, Company Signatories, Letter Templates, Performance Appraisal.

## 2. Leave

**General:** leave year starts January · custom message on application form · email
employee/manager when an admin withdraws leave · shared calendar visibility ("Show
everyone") · include terminated employees in reports · allow applying against next
year's balance.

**Leave policies (as configured at Interact):**

| Type | Entitlement | Attachment required | Enabled |
|------|-------------|---------------------|---------|
| Annual | 12 | No | Yes |
| Carry Forward | 10 (cap) | No | Yes |
| Compassionate | 5 | No | Yes |
| Hospitalisation | — | Yes | **No** |
| Maternity | **60** | Yes | Yes |
| Paternity | — | No | **No** |
| Sick | 14 | Yes | Yes |
| Unpaid | 12 | No | Yes |

Per-policy fields: entitlement days for all employees, paid (y/n), attachment mandatory
(y/n), **custom entitlement** (by service / group, currently off). "Add Custom Policy".

**Advanced settings (Interact's choices in bold):** entitlement calculation —
**accrual on pro-rata basis** / full entitlement pro-rata / accrual first year then full;
pro-rata by **day** / month; rounding — **round up to nearest half day** (round down
available); "rounding according to Employment Act" option (off); carry-forward expires in
**3 months**; replacement leave — **enabled**, carry forward unused **yes**, attachment
**no**; emergency leave — **enabled**, leave applied within **3 days** = emergency
(manager email tagged [EMERGENCY]).

**Approval:** multi-level approval with "Supervisors"; default workflow **Direct Manager →
HR Admins**; custom approval workflows; option to give reporting managers access to leave
reports for their direct reports.

**Screens:** Leave Calendar (month view, public holidays by location, legend colour per
leave type, filter holiday by location) · Apply for Leave (employee, leave type with
available balance shown, date range, Full day / AM / PM, reason*, supporting document) ·
View Applications (filters name / location / department / date range; columns Employee,
From, To, Days, Reason, Attachment, Type, Applied, Status + approver and date; bulk
Approve / Decline; Export) · Replacement Credit (apply / batch apply for working on a
PH or weekend; credited on manager approval) · Leave Reports (Leave Balances grouped by
department with months of service and per-type used/entitled, effective-as-at date;
Report by Individual; Report by Leave Type and Department; Export).

## 3. Claims

**Claim categories (20):** Business Meals with Prospect Clients · Business Meeting Meal
with Customers · Business Travel – Air, Train, Sea Tickets · Business Travel – Hardship
Allowances · Business Travel – Hotels, Accommodations · Business Travel – Meals ·
Business Travel – Taxi, eHailing, Local Transportation · Customer Marketing / Sales
Expenses · Employee Communications · Employee Transport · Employee Travel · Employee
Wellbeing · Equipment Upright Purchase – PC, Notebook, Mobile Phone · Meals for Employees
· Medical Claim – Direct Staff (**RM 300 per transaction**) · Office Expenses · Parking –
Season Office · Postal & Courier Expenses · Software Subscriptions · Telecoms Internet,
Mobile Expenses. All others: no transaction / monthly / yearly limit.

**Settings:** limits per employee per transaction / month / year; limit refresh & payroll
cut-off date (31st); **mileage claims** — RM rate per km per category (Employee
Transport, Employee Travel), employee enters km and amount is computed; **specific
limits** by employee / group / department (override category limits); notify approvers
on submit (**on**); attachments required (**on**); notes required (off); include
terminated employees; currency symbol MYR (display only).

**New claim form:** Employee*, Category*, Date of Transaction*, Total Claim Amount (MYR)*,
**Tax Invoice / Receipt / e-Invoice No.**, **Unique Identifier No. / UUID** (LHDN
MyInvois e-invoice), **To include SST** (SST amount), Notes, Attachments (max 1 MB).
Bulk Claims entry also available.

**Claims list:** KPI strip — pending, approved + paid, rejected, total excl. SST, total
SST, total. Filters — employee, date range, category, status; "only claims under my
approval". Columns — Employee, Date of Transaction, Date of Application, Category, More
Info (claim #, mileage, description), Amount, Attachments, Receipt/e-Invoice No., UUID,
Date of Approval/Rejection, Status. Bulk Approve / Reject / **Download Claims
Attachments**. **Export to: Excel, Bank pay file, QuickBooks, Bukku.** Summary Report
(XLSX by date range). Volume: ~200 claims since go-live.

**Payment:** approved claims are currently **"Paid with Payroll"** (with Undo payment).

## 4. Roles & access

"Manage Admins for All Modules": admins are assigned **per module** (HR, Payroll, Claim,
Hadir) with a module role. Currently: CEO (all modules), Finance Manager (Claim,
Payroll, HR role), HR & Admin (Claim, Payroll, HR role). Reporting managers can be
granted report access limited to their direct reports. 2FA available at company level.

---

## 5. Findings for PRET

**Keep (Kakitangan does it well):** per-module admin roles · leave balance shown in the
apply form · AM/PM half days · accrual pro-rata with half-day rounding · replacement
credit workflow · emergency-leave flag · carry-forward cap + expiry · mileage rate per
km · e-Invoice/receipt no., UUID and SST capture per claim · bulk approve/reject ·
attachment bundle download · bank pay file export · leave balance report as at a date ·
activity log per employee · opening balances on employee creation.

**Compliance gaps in the current configuration (Employment Act 1955 as amended 2022) —
please verify:**
1. **Maternity is set to 60 days**; the statutory minimum is now **98 consecutive days**.
2. **Paternity leave is disabled**; statutory 7 consecutive days for eligible married
   male employees.
3. **Hospitalisation leave is disabled**; statutory up to 60 days per year (aggregate with sick leave).
4. **Annual (12) and sick (14) are flat for everyone** (custom entitlement off). The Act
   scales with service: annual 8 / 12 / 16 days and sick 14 / 18 / 22 days for <2 / 2–5 / ≥5
   years. Employees with 2+ years' service are below the sick-leave minimum; with 5+ years,
   below the annual minimum.

**Decisions this raises for Phase 1:**
- Claims are reimbursed **through Kakitangan payroll** today. While our payroll is
  Phase 2, approved claims from the new HRMS must still reach payroll: either export them
  in a format Kakitangan payroll can import, or pay them via an HLB Connect First bulk file.
- Should PRET also absorb the Kakitangan features not in Phase 1 scope:
  company assets register, training & certifications, org chart, letter templates,
  appraisal, Hadir attendance?
- Accounting export targets (QuickBooks / Bukku) — which does Interact use?
