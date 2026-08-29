import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CalendarDays,
  Building2,
  Users,
  AlertTriangle,
  RefreshCw,
  Zap,
  DoorOpen,
  PanelTop,
  CheckCircle2,
  Search,
  Sparkles,
  X,
  Clock3,
  ArrowRight,
  History,
  ShieldCheck,
  UserCheck,
  BarChart3,
  Timer,
  AlertCircle,
} from "lucide-react";

import {
  getSummary,
  getInterviews,
  seed,
  replan,
  getCompanies,
  getStudents,
  getRooms,
  getDisruptions,
  getUnscheduledStudents,
  changeRoomStatus,
} from "./services/api";

import "./styles.css";

const tm = (m = 0) =>
  `${String(Math.floor(Number(m) / 60)).padStart(2, "0")}:${String(
    Number(m) % 60
  ).padStart(2, "0")}`;

const pri = (p) =>
  Number(p) === 1
    ? ["Tier 1", "high"]
    : Number(p) === 2
      ? ["Tier 2", "medium"]
      : ["Tier 3", "low"];

const err = (e) =>
  e?.response?.data?.message ||
  e?.message ||
  "Something went wrong.";

const statusClass = (status) =>
({
  Eligible: "eligible",
  Withdrawn: "withdrawn",
  Ineligible: "ineligible",
  Placed: "placed",
  "Withdrawn + Placed": "withdrawnPlaced",
}[status] || "");

function App() {
  const [page, setPage] = useState("overview");

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [students, setStudents] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [history, setHistory] = useState([]);
  const [unscheduledStudents, setUnscheduledStudents] = useState([]);

  const [day, setDay] = useState("");
  const [q, setQ] = useState("");

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [result, setResult] = useState(null);
  const [modal, setModal] = useState(null);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(window.__placementToastTimer);
    window.__placementToastTimer = window.setTimeout(
      () => setToast(""),
      5000
    );
  };

  const load = async () => {
    const [s, i, c, st, r, d, u] = await Promise.all([
      getSummary(),
      getInterviews(),
      getCompanies(),
      getStudents(),
      getRooms(),
      getDisruptions(),
      getUnscheduledStudents(),
    ]);

    setSummary(s.data);
    setRows(i.data || []);
    setCompanies(c.data || []);
    setStudents(st.data || []);
    setRooms(r.data || []);
    setHistory(d.data || []);
    setUnscheduledStudents(u.data?.students || []);
  };

  useEffect(() => {
    load().catch((e) => notify(err(e)));
  }, []);

  const refresh = async () => {
    setLoading(true);

    try {
      await load();
      notify("Dashboard refreshed.");
    } catch (e) {
      notify(err(e));
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    setLoading(true);

    try {
      const response = await seed();
      await load();

      notify(
        `Generated ${response.data?.students ?? 0} students, ${response.data?.companies ?? 0
        } companies and ${response.data?.scheduled ?? 0
        } scheduled interviews.`
      );
    } catch (e) {
      notify(err(e));
    } finally {
      setLoading(false);
    }
  };

  const openDisruption = (type = "company_delay") => {
    setResult(null);

    setModal({
      type,
      target: "",
      hours: 2,
      panel: 1,
      roomAction: "unavailable",
    });
  };

  const runReplan = async (form) => {
    setLoading(true);

    try {
      let response;

      if (form.type === "room_unavailable") {
        response = await changeRoomStatus(
          form.target,
          form.roomAction
        );
      } else {
        response = await replan({
          type: form.type,
          id: form.target,
          hours: Number(form.hours),
          panel: Number(form.panel),
        });
      }

      setResult(response.data);
      await load();

      notify("Disruption applied. Schedule and counts were updated.");
    } catch (e) {
      notify(err(e));
    } finally {
      setLoading(false);
    }
  };

  const nav = [
    ["overview", "Overview", LayoutDashboard],
    ["schedule", "Schedule", CalendarDays],
    ["companies", "Companies", Building2],
    ["students", "Students", Users],
    ["student-status", "Student Status", UserCheck],
    ["rooms", "Rooms", DoorOpen],
    ["unscheduled", "Unscheduled Students", AlertTriangle],
    ["disruptions", "Disruptions", AlertTriangle],
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Sparkles size={18} />
          </div>

          <div>
            <b>PlacementOS</b>
            <span>Mirai Labs • Assignment A</span>
          </div>
        </div>

        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "nav active" : "nav"}
              onClick={() => {
                setPage(key);
                setQ("");
              }}
            >
              <Icon size={17} />
              {label}

              {key === "schedule" && summary && (
                <em>{summary.scheduled ?? 0}</em>
              )}
            </button>
          ))}
        </nav>

        <div className="sideFoot">
          <span className="online">
            <i />
            System online
          </span>
          <small>4-day placement week</small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">PLACEMENT COMMAND CENTER</div>

            <h1>
              {page === "overview"
                ? "Good morning, Coordinator"
                : page === "schedule"
                  ? "Interview schedule"
                  : page === "companies"
                    ? "Recruiting companies"
                    : page === "students"
                      ? "Student directory"
                      : page === "student-status"
                        ? "Student status & eligibility"
                        : page === "rooms"
                          ? "Room monitoring"
                          : page === "unscheduled"
                            ? "Unscheduled students"
                            : "Disruption simulator"}
            </h1>

            <p>
              {page === "overview"
                ? "Monitor readiness, scheduling requirements and operational changes."
                : page === "schedule"
                  ? "Search across student, company, room, branch and panel."
                  : page === "companies"
                    ? "Real company names, panels, interviewers and shortlisted students."
                    : page === "students"
                      ? "800 unique full names with unique student codes."
                      : page === "student-status"
                        ? "See eligibility, shortlisted companies, ineligible companies and placement history."
                        : page === "rooms"
                          ? "See every room, panel, recruiter and candidate across the 4-day schedule."
                          : page === "unscheduled"
                            ? "See students whose shortlisted company interviews could not be scheduled."
                            : "Inject a disruption and read the exact before/after action."}
            </p>
          </div>

          <div className="actions">
            <button
              className="ghost"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? "spin" : ""}
              />
              Refresh
            </button>

            <button onClick={generate} disabled={loading}>
              <Zap size={16} />
              {loading ? "Working..." : "Generate / Reset"}
            </button>
          </div>
        </header>

        {toast && (
          <div className="toast">
            <CheckCircle2 size={17} />
            {toast}
          </div>
        )}

        {page === "overview" && (
          <Overview
            summary={summary}
            rows={rows}
            go={setPage}
            open={() => openDisruption("company_delay")}
          />
        )}

        {page === "schedule" && (
          <Schedule
            rows={rows}
            day={day}
            setDay={setDay}
            q={q}
            setQ={setQ}
          />
        )}

        {page === "companies" && (
          <Companies
            data={companies}
            q={q}
            setQ={setQ}
          />
        )}

        {page === "students" && (
          <Students
            data={students}
            q={q}
            setQ={setQ}
          />
        )}

        {page === "student-status" && (
          <StudentStatus
            data={students}
            q={q}
            setQ={setQ}
          />
        )}

        {page === "rooms" && (
          <Rooms
            data={rooms}
            rows={rows}
          />
        )}

        {page === "unscheduled" && (
          <UnscheduledStudents
            data={unscheduledStudents}
          />
        )}

        {page === "disruptions" && (
          <Disruptions
            open={openDisruption}
            history={history}
            rooms={rooms}
            setRoomStatus={async (id, status) => {
              setLoading(true);

              try {
                const response = await changeRoomStatus(
                  id,
                  status
                );

                notify(response.data?.message || "Room updated.");
                await load();
              } catch (e) {
                notify(err(e));
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
      </main>

      {modal && (
        <>
          {modal.type === "student_withdrawal" ? (
            <DisruptionWithdrawalModal
              student={students.find(
                (student) => student._id === modal.target
              )}
              students={students}
              selectStudent={(id) => {
                setResult(null);

                setModal((current) => ({
                  ...current,
                  target: id,
                }));
              }}
              companies={companies}
              result={result}
              loading={loading}
              close={() => {
                setModal(null);
                setResult(null);
              }}
              process={async (mode, companyId) => {
                setLoading(true);

                try {
                  const response = await replan({
                    type: "student_withdrawal",
                    id: modal.target,
                    withdrawalMode: mode,
                    companyId,
                  });

                  setResult(response.data);
                  await load();
                } catch (e) {
                  notify(err(e));
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : (
            <Modal
              form={modal}
              setForm={setModal}
              companies={companies}
              students={students}
              rooms={rooms}
              result={result}
              loading={loading}
              run={() => runReplan(modal)}
              close={() => {
                setModal(null);
                setResult(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Card({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat">
      <div className="statIcon">
        <Icon size={19} />
      </div>

      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
}

function Overview({ summary, rows, go, open }) {
  const pct = summary?.scheduledPct ?? 0;

  return (
    <>
      <section className="stats">
        <Card
          icon={Building2}
          label="Companies"
          value={summary?.companies ?? "—"}
          sub="35 real company records"
        />

        <Card
          icon={Users}
          label="Students"
          value={summary?.students ?? "—"}
          sub="800 unique full names"
        />

        <Card
          icon={CalendarDays}
          label="Scheduled"
          value={
            summary
              ? `${summary.scheduled ?? 0} / ${summary.shortlisted ?? 0
              }`
              : "—"
          }
          sub={`${pct}% of active interview requirements`}
        />

        <Card
          icon={DoorOpen}
          label="Rooms"
          value={summary?.rooms ?? "—"}
          sub={`${summary?.unavailableRooms ?? 0} unavailable`}
        />
      </section>

      <section className="healthGrid">
        <div className="panel healthMain">
          <Head
            title="Placement Status"
            sub="Monitor live interview scheduling and placement progress."
            badge={summary?.healthStatus || "Healthy"}
          />

          <div className="kpiHero">
            <div>
              <small>INTERVIEWS SCHEDULED</small>

              <strong>
                {summary?.scheduled ?? "—"} /{" "}
                {summary?.shortlisted ?? "—"}
              </strong>

              <b>{pct}%</b>

              <div className="progress">
                <i
                  style={{
                    width: `${Math.min(100, pct)}%`,
                  }}
                />
              </div>
            </div>

            <div className="unscheduledKpi">
              <small>UNSCHEDULED</small>
              <strong>{summary?.unscheduled ?? "—"}</strong>
              <span>{summary?.unscheduledPct ?? 0}%</span>
            </div>
          </div>

          <div className="healthCards">
            <Metric
              label="Student clashes"
              value={summary?.studentClashes ?? "—"}
              sub={
                summary?.studentClashes === 0
                  ? "✓ Conflict-free"
                  : "⚠ Needs attention"
              }
              icon={ShieldCheck}
            />

            <Metric
              label="Room availability"
              value={`${summary?.roomUtilisation ?? 0}%`}
              sub={`${summary?.availableRooms ?? 0} / ${summary?.rooms ?? 0} rooms available`}
              icon={DoorOpen}
            />

            <Metric
              label="Average waiting time"
              value={`${summary?.averageWaitingMinutes ?? 0} min`}
              sub="Target ≤ 10 min"
              icon={Timer}
            />

            <Metric
              label="Replan churn"
              value={`${summary?.replanChurn ?? 0}%`}
              sub="Moved appointments / scheduled"
              icon={BarChart3}
            />

            <Metric
              label="Upcoming conflicts"
              value={summary?.upcomingConflicts ?? 0}
              sub={
                summary?.upcomingConflicts
                  ? "⚠ Review required"
                  : "✓ No conflicts detected"
              }
              icon={AlertCircle}
            />

            <Metric
              label="Transition buffer"
              value={`${summary?.bufferMinutes ?? 10} min`}
              sub="Required between student interviews"
              icon={Clock3}
            />
          </div>
        </div>

        <div className="panel actionPanel">
          <Head
            title="Disruption center"
            sub="Run company, panel, student or room events."
          />

          <button className="actionBox" onClick={open}>
            <span className="actionIcon">
              <Zap />
            </span>

            <span>
              <b>One-click replan</b>
              <small>
                See exactly what was released, moved and replaced.
              </small>
            </span>

            <ArrowRight />
          </button>

          <div className="dayChart">
            <b>Day distribution</b>

            {(summary?.dayCounts || []).map((item) => (
              <div key={item.day}>
                <span>Day {item.day}</span>

                <i>
                  <em
                    style={{
                      width: `${summary?.shortlisted
                          ? Math.min(
                            100,
                            (item.count /
                              summary.shortlisted) *
                            100
                          )
                          : 0
                        }%`,
                    }}
                  />
                </i>

                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel quick">
        <Head
          title="Test flow"
          sub="Recommended order for your assessment demo."
        />

        <div className="quickGrid">
          {[
            [
              "Schedule",
              "Search and Day 1–4 filters",
              CalendarDays,
            ],
            [
              "Companies",
              "Panels + interviewers + shortlisted students",
              Building2,
            ],
            [
              "Students",
              "Unique names and eligibility",
              Users,
            ],
            [
              "Student Status",
              "Read-only eligibility and placement details",
              UserCheck,
            ],
            [
              "Rooms",
              "Room → company → panel → candidates",
              DoorOpen,
            ],
            [
              "Disruptions",
              "Company delay / panel / student / room",
              AlertTriangle,
            ],
          ].map(([title, description, Icon]) => (
            <button
              key={title}
              onClick={() =>
                go(
                  title === "Student Status"
                    ? "student-status"
                    : title.toLowerCase()
                )
              }
            >
              <Icon />

              <span>
                <b>{title}</b>
                <small>{description}</small>
              </span>

              <ArrowRight />
            </button>
          ))}
        </div>
      </section>

      <Schedule rows={rows.slice(0, 12)} compact />
    </>
  );
}

function Metric({ label, value, sub, icon: Icon }) {
  return (
    <div className="metric">
      <Icon size={18} />

      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
}

function Head({ title, sub, badge }) {
  return (
    <div className="head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>

      {badge && (
        <span className="badge">
          <i /> {badge}
        </span>
      )}
    </div>
  );
}

function Schedule({
  rows,
  day,
  setDay,
  q,
  setQ,
  compact = false,
}) {
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const panel = (
        row.companyId?.panelDetails || []
      ).find((item) => item.number === row.panel);

      const searchable = `
        ${row.studentId?.studentCode || ""}
        ${row.studentId?.name || ""}
        ${row.companyId?.name || ""}
        ${row.studentId?.branch || ""}
        ${row.roomId?.name || ""}
        panel ${row.panel || ""}
        ${panel?.interviewers?.join(" ") || ""}
      `.toLowerCase();

      return (
        (!day || String(row.day) === String(day)) &&
        (!q || searchable.includes(q.toLowerCase()))
      );
    });
  }, [rows, day, q]);

  return (
    <section
      className={`panel schedule ${compact ? "compact" : ""
        }`}
    >
      <div className="head">
        <div>
          <h2>Interview schedule</h2>
          <p>
            {compact
              ? "Latest appointments."
              : "Every appointment shows company, student, room, panel and interviewer."}
          </p>
        </div>

        {!compact && (
          <div className="tools">
            <div className="search">
              <Search size={16} />

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search student, company, room or panel..."
              />
            </div>

            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              <option value="">All days</option>

              {[1, 2, 3, 4].map((item) => (
                <option key={item} value={item}>
                  Day {item}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!compact && (
        <div className="tabs">
          {["", 1, 2, 3, 4].map((item) => (
            <button
              key={item}
              className={
                String(day) === String(item)
                  ? "selected"
                  : ""
              }
              onClick={() =>
                setDay(String(item))
              }
            >
              {item === "" ? "All" : `Day ${item}`}
            </button>
          ))}
        </div>
      )}

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>TIME</th>
              <th>STUDENT</th>
              <th>COMPANY</th>
              <th>ROOM</th>
              <th>PANEL / INTERVIEWERS</th>
              <th>BRANCH</th>
              <th>PRIORITY</th>
              <th>STATUS</th>
            </tr>
          </thead>

          <tbody>
            {filtered
              .slice(0, compact ? 12 : 2000)
              .map((row) => {
                const panel = (
                  row.companyId?.panelDetails || []
                ).find(
                  (item) => item.number === row.panel
                );

                return (
                  <tr key={row._id}>
                    <td className="time">
                      D{row.day} ·{" "}
                      {tm(row.startMinute)}–
                      {tm(row.endMinute)}
                    </td>

                    <td>
                      <div className="person">
                        <span className="avatar">
                          {row.studentId?.name?.[0] || "?"}
                        </span>

                        <span>
                          <b>{row.studentId?.name}</b>
                          <small>
                            {row.studentId?.studentCode} ·
                            CGPA {row.studentId?.cgpa}
                          </small>
                        </span>
                      </div>
                    </td>

                    <td>
                      <b>{row.companyId?.name}</b>
                    </td>

                    <td>
                      <span className="room">
                        {row.roomId?.name}
                      </span>
                    </td>

                    <td>
                      <span className="pill">
                        Panel {row.panel}
                      </span>

                      <small className="subline">
                        {panel?.interviewers?.join(
                          " + "
                        ) || "Interviewer not recorded"}
                      </small>
                    </td>

                    <td>{row.studentId?.branch}</td>

                    <td>
                      <span
                        className={`priority ${pri(row.companyId?.priority)[1]
                          }`}
                      >
                        {pri(
                          row.companyId?.priority
                        )[0]}
                      </span>
                    </td>

                    <td>
                      <span className="status">
                        <i />
                        Scheduled
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {!filtered.length && (
          <div className="empty">
            No appointments match your search/filter.
          </div>
        )}
      </div>

      <div className="foot">
        Showing{" "}
        {Math.min(
          filtered.length,
          compact ? 12 : 2000
        )}{" "}
        appointments

        {!compact && (
          <span>
            10-minute transition buffer enforced.
          </span>
        )}
      </div>
    </section>
  );
}

function Companies({ data, q, setQ }) {
  const filtered = useMemo(() => {
    return data.filter((company) =>
      `${company.name} ${company.priority} ${company.cgpaCutoff}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  }, [data, q]);

  return (
    <section className="panel directory">
      <Toolbar
        title="Companies"
        q={q}
        setQ={setQ}
        placeholder="Search company..."
      />

      <div className="companyGrid">
        {filtered.map((company) => (
          <CompanyCard
            key={company._id}
            c={company}
          />
        ))}
      </div>
    </section>
  );
}

function CompanyCard({ c }) {
  const [show, setShow] = useState(false);

  return (
    <div className="companyCard">
      <div className="companyTop">
        <span className="companyIcon">
          <Building2 />
        </span>

        <div>
          <b>{c.name}</b>

          <small>
            Day{(c.days || [c.day]).length > 1 ? "s" : ""} {(c.days || [c.day]).join(", ")} · {tm(c.startMinute)}–
            {tm(c.endMinute)} · {c.duration} min
          </small>
        </div>

        <span
          className={`priority ${pri(c.priority)[1]
            }`}
        >
          {pri(c.priority)[0]}
        </span>
      </div>

      <div className="companyStats">
        <span>
          <b>{c.shortlistCount || 0}</b>
          shortlisted
        </span>

        <span>
          <b>
            {(c.panels || 0) -
              (c.blockedPanels?.length || 0)}
          </b>
          active panels
        </span>

        <span>
          <b>{c.cgpaCutoff ?? "—"}</b>
          CGPA cutoff
        </span>

        <span>
          <b>{c.placedStudents?.length || 0}</b>
          placed
        </span>
      </div>

      <div className="panelList">
        {(c.panelDetails || []).map((panel) => (
          <div
            key={panel.number}
            className={
              (c.blockedPanels || []).includes(
                panel.number
              )
                ? "panelDropped"
                : ""
            }
          >
            <span className="pill">
              Panel {panel.number}
            </span>

            <small>
              {panel.interviewers?.join(" + ")}

              {(c.blockedPanels || []).includes(
                panel.number
              )
                ? " · Dropped"
                : ""}
            </small>
          </div>
        ))}
      </div>

      <button
        className="expand"
        onClick={() => setShow(true)}
      >
        <Users size={15} />
        View shortlisted students (
        {c.shortlistCount || 0})
      </button>

      {(c.placedStudents?.length || 0) > 0 && (
        <button
          className="expand placedLink"
          onClick={() => setShow(true)}
        >
          View placed students (
          {c.placedStudents.length})
        </button>
      )}

      {show && (
        <CompanyStudentsModal
          c={c}
          close={() => setShow(false)}
        />
      )}
    </div>
  );
}

function CompanyStudentsModal({ c, close }) {
  const [tab, setTab] = useState("shortlisted");
  const [q, setQ] = useState("");

  const list =
    tab === "shortlisted"
      ? c.shortlistedStudents || []
      : c.placedStudents || [];

  const filtered = list.filter((student) =>
    `${student.studentCode} ${student.name} ${student.branch} ${student.cgpa} ${student.status}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  return (
    <div className="overlay">
      <div className="modal wide">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">
              COMPANY DIRECTORY
            </div>

            <h2>{c.name} · Students</h2>

            <p>
              Full student list is shown here so the
              company card height stays unchanged.
            </p>
          </div>

          <button
            className="close"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modalTabs">
          <button
            className={
              tab === "shortlisted"
                ? "selected"
                : ""
            }
            onClick={() => setTab("shortlisted")}
          >
            Shortlisted (
            {c.shortlistedStudents?.length || 0})
          </button>

          <button
            className={
              tab === "placed" ? "selected" : ""
            }
            onClick={() => setTab("placed")}
          >
            Placed (
            {c.placedStudents?.length || 0})
          </button>
        </div>

        <div className="search">
          <Search size={16} />

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search student..."
          />
        </div>

        <div className="studentModalList">
          {filtered.map((student) => (
            <div key={student._id}>
              <b>{student.studentCode}</b>
              <span>{student.name}</span>
              <span>{student.branch}</span>
              <span>CGPA {student.cgpa}</span>
              <Status status={student.status} />
            </div>
          ))}

          {!filtered.length && (
            <div className="empty">
              No students match.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Students({ data, q, setQ }) {
  const filtered = useMemo(() => {
    return data.filter((student) =>
      `${student.studentCode} ${student.name} ${student.branch} ${student.status}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  }, [data, q]);

  return (
    <section className="panel directory">
      <Toolbar
        title="Students"
        q={q}
        setQ={setQ}
        placeholder="Search unique name, code, branch or status..."
      />

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>CODE</th>
              <th>NAME</th>
              <th>BRANCH</th>
              <th>CGPA</th>
              <th>STATUS</th>
              <th>SHORTLISTED</th>
              <th>SCHEDULED</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((student) => (
              <tr key={student._id}>
                <td className="code">
                  {student.studentCode}
                </td>

                <td>
                  <b>{student.name}</b>
                </td>

                <td>{student.branch}</td>

                <td>
                  <b>{student.cgpa}</b>
                </td>

                <td>
                  <Status status={student.status} />
                </td>

                <td>
                  {student.shortlistedCompanyCount ??
                    0}
                </td>

                <td>
                  {student.scheduledInterviewCount ??
                    0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Status({ status }) {
  return (
    <span
      className={`statusTag ${statusClass(status)}`}
    >
      {status}
    </span>
  );
}

function UnscheduledStudents({ data }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(item =>
      `${item.studentCode} ${item.name} ${(item.unscheduledCompanyNames || []).join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  }, [data, q]);

  return (
    <section className="panel directory unscheduledPage">
      <Head
        title="Unscheduled students"
        sub="Each student appears once. All shortlisted companies that remain unscheduled are shown together."
      />

      <div className="unscheduledToolbar">
        <div className="unscheduledCount">
            <span>unscheduled interview opportunities</span>

        </div>

        <div className="search unscheduledSearch">
          <Search size={16} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search student code, name or company..."
          />
        </div>
      </div>

      <div className="unscheduledTable">
        <div className="unscheduledTableHead">
          <span>Student Code</span>
          <span>Student Name</span>
          <span>Unscheduled Company Names</span>
        </div>

        <div className="unscheduledTableBody">
          {filtered.map(item => (
            <div className="unscheduledRow" key={item.studentId}>
              <b>{item.studentCode}</b>
              <span>{item.name}</span>
              <div className="companyChips">
                {(item.unscheduledCompanyNames || []).map(name => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            </div>
          ))}

          {!filtered.length && (
            <div className="empty">No unscheduled students match.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function Rooms({ data, rows }) {
  const [selected, setSelected] = useState(null);

  return (
    <section className="panel directory roomsPage">
      <Head
        title="Rooms"
        sub="Live room monitoring across the 4-day placement week."
      />

      <div className="roomOverviewGrid">
        {data.map((room) => {
          const roomRows = rows.filter(
            (row) => String(row.roomId?._id || row.roomId) === String(room._id)
          );
          // const candidateCount = new Set(
          //   roomRows.map((row) => String(row.studentId?._id || row.studentId)).filter(Boolean)
          // ).size;

          const interviewCount = roomRows.length;
          
          // A panel is counted per interview day. The same company/panel
          // operating on Day 1 and Day 2 is two active day-wise panel streams.
          // This keeps the overview count consistent with the day tabs below.
          const panelCount = new Set(
            roomRows.map((row) =>
              `${row.day}-${row.companyId?._id || row.companyId}-${row.panel}`
            )
          ).size;

          return (
            <button
              className="roomOverviewCard"
              key={room._id}
              onClick={() => setSelected(room._id)}
            >
              <div>
                <b>{room.name}</b>
                <span>{room.floor}</span>
              </div>

              <Status
                status={room.status === "available" ? "Available" : "Unavailable"}
              />

              {/* <strong>{candidateCount}</strong>
              <small>{candidateCount}{roomRows.len}total interviews · {panelCount} total panels</small>
            </button> */}
              <strong>{interviewCount}</strong>
              <small>
                {interviewCount} total interviews · {panelCount} total panels
              </small>
            </button>
          );
        })}
      </div>

      {selected && (
        <RoomDetail
          room={data.find((room) => room._id === selected)}
          rows={rows}
          close={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function RoomDetail({ room, rows, close }) {
  const [selectedDay, setSelectedDay] = useState(1);
  if (!room) return null;

  const roomRows = rows
    .filter((row) => String(row.roomId?._id || row.roomId) === String(room._id))
    .sort((a, b) => Number(a.day) - Number(b.day));

  // Room totals are calculated across the complete 4-day placement week.
  const totalCandidates = new Set(
    roomRows
      .map((row) => String(row.studentId?._id || row.studentId || ""))
      .filter(Boolean)
  ).size;

  // Count panel streams day-wise. If the same company/panel conducts
  // interviews on multiple days, each day is a separate active stream.
  // Therefore Day 1 = 4, Day 2 = 4 and Day 4 = 1 correctly displays 9.
  const totalPanels = new Set(
    roomRows.map((row) =>
      `${row.day}-${row.companyId?._id || row.companyId}-${row.panel}`
    )
  ).size;

  const dayPanels = useMemo(() => {
    const map = new Map();

    roomRows
      .filter((row) => Number(row.day) === selectedDay)
      .forEach((row) => {
        const companyId = row.companyId?._id || row.companyId;
        const key = `${companyId}-${row.panel}`;

        if (!map.has(key)) {
          map.set(key, {
            key,
            company: row.companyId,
            panel: row.panel
          });
        }
      });

    return Array.from(map.values()).sort((a, b) =>
      String(a.company?.name || "").localeCompare(String(b.company?.name || "")) ||
      Number(a.panel || 0) - Number(b.panel || 0)
    );
  }, [roomRows, selectedDay]);

  const getDayPanels = (day) => {
    const map = new Map();

    roomRows
      .filter((row) => Number(row.day) === day)
      .forEach((row) => {
        const companyId = row.companyId?._id || row.companyId;
        const key = `${companyId}-${row.panel}`;
        if (!map.has(key)) {
          map.set(key, key);
        }
      });

    return Array.from(map.keys());
  };

  return (
    <div className="overlay">
      <div className="modal roomModal wide roomModalRedesigned roomDayWiseModal">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">ROOM MONITORING</div>
            <h2>{room.name}</h2>
            <p>
              {room.floor} · Status: {" "}
              <b>{room.status === "available" ? "Available" : "Unavailable"}</b>
            </p>
          </div>
          <button className="close" onClick={close} aria-label="Close room monitoring">
            <X size={18} />
          </button>
        </div>

        <div className="roomDetailStats">
          <Metric
            label="Total interviews"
            value={roomRows.length}
            sub="Scheduled across all 4 days"
            icon={CalendarDays}
          />

          {/* <Metric
            label="Total candidates"
            value={totalCandidates}
            sub="Unique candidates across all 4 days"
            icon={Users}
          /> */}

          <Metric
            label="Total panels in this room"
            value={totalPanels}
            sub="Company panels assigned across all 4 days"
            icon={PanelTop}
          />
        </div>

        <div className="roomDaySelector roomDaySelectorClean">
          <div>
            <b>Interview days</b>
            <span>Click a day to see only the panels conducting interviews in this room.</span>
          </div>

          <div className="roomDayTabs roomDayTabsClean">
            {[1, 2, 3, 4].map((day) => {
              const panels = getDayPanels(day);

              return (
                <button
                  key={day}
                  className={selectedDay === day ? "selected" : ""}
                  onClick={() => setSelectedDay(day)}
                >
                  <strong>Day {day}</strong>
                  <small>{panels.length} total panel{panels.length === 1 ? "" : "s"}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="roomDayPanelList">
          <div className="roomDayPanelListHeader">
            <div>
              <b>Day {selectedDay} · Panels conducting interviews</b>
              <span>Company, panel number and recruiter/interviewer information only.</span>
            </div>
            <strong>{dayPanels.length} total panels</strong>
          </div>

          {dayPanels.length ? (
            <div className="roomDayPanelCards">
              {dayPanels.map((item) => {
                const panelMeta = (item.company?.panelDetails || []).find(
                  (panel) => Number(panel.number) === Number(item.panel)
                );

                return (
                  <div className="roomDayPanelCard" key={item.key}>
                    <div className="roomDayPanelCardNumber">
                      Panel {item.panel}
                    </div>
                    <div className="roomDayPanelCardBody">
                      <h3>{item.company?.name || "Company"}</h3>
                      <p>
                        Recruiter / Interviewer: {" "}
                        <b>
                          {panelMeta?.interviewers?.join(" + ") || "Not recorded"}
                        </b>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="roomNoDayPanels roomNoDayPanelsClean">
              No panels are conducting interviews in this room on Day {selectedDay}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentStatus({ data, q, setQ }) {
  const [expanded, setExpanded] =
    useState(null);

  const filtered = useMemo(() => {
    return data.filter((student) =>
      `${student.studentCode} ${student.name} ${student.branch} ${student.status}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  }, [data, q]);

  return (
    <section className="panel directory">
      <Head
        title="Student status & eligibility"
        sub="Read-only student profile: eligibility, shortlist history, placement and current interview schedule."
      />

      <div className="statusLegend">
        <span>
          <Status status="Eligible" />
          Can be shortlisted and scheduled.
        </span>

        <span>
          <Status status="Withdrawn" />
          Future interviews removed.
        </span>

        <span>
          <Status status="Ineligible" />
          Does not meet a company cutoff.
        </span>

        <span>
          <Status status="Placed" />
          Offer accepted; remaining interviews cancelled.
        </span>
      </div>

      <Toolbar
        title="All student records"
        q={q}
        setQ={setQ}
        placeholder="Search student..."
      />

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>CODE / NAME</th>
              <th>CGPA</th>
              <th>STATUS</th>
              <th>ELIGIBLE COMPANIES</th>
              <th>SHORTLISTED</th>
              <th>WITHDRAWN / CANCELLED</th>
              <th>DETAILS</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((student) => (
              <React.Fragment
                key={student._id}
              >
                <tr>
                  <td>
                    <b>{student.studentCode}</b>
                    <div>{student.name}</div>
                    <small>{student.branch}</small>
                  </td>

                  <td>{student.cgpa}</td>

                  <td>
                    <Status
                      status={student.status}
                    />
                  </td>

                  <td>
                    {student.eligibleCompanyCount ??
                      0}
                  </td>

                  <td>
                    {student.shortlistedCompanyCount ??
                      0}
                  </td>

                  <td>
                    {student.withdrawnInterviewCount ||
                      0}{" "}
                    /{" "}
                    {student.cancelledInterviewCount ||
                      0}
                  </td>

                  <td>
                    <button
                      className="mini ghost"
                      onClick={() =>
                        setExpanded(
                          expanded === student._id
                            ? null
                            : student._id
                        )
                      }
                    >
                      {expanded === student._id
                        ? "Hide details"
                        : "View details"}
                    </button>
                  </td>
                </tr>

                {expanded === student._id && (
                  <tr>
                    <td colSpan="7">
                      <div className="studentDetail statusDetail">
                        <div className="detailCard">
                          <b>
                            Shortlisted companies (
                            {
                              student.shortlistedCompanyCount
                            }
                            )
                          </b>

                          <div className="companyChips">
                            {(
                              student.shortlistedCompanies ||
                              []
                            ).map((company) => (
                              <span
                                key={company}
                                className="companyChip"
                              >
                                {company}
                              </span>
                            ))}

                            {!student
                              .shortlistedCompanies
                              ?.length && (
                                <span className="muted">
                                  No active shortlist
                                  records.
                                </span>
                              )}
                          </div>
                        </div>

                        <div className="detailCard">
                          <b>
                            Eligible companies (
                            {
                              student.eligibleCompanyCount
                            }
                            )
                          </b>

                          <div className="companyChips">
                            {(
                              student.eligibleCompanies ||
                              []
                            ).map((company) => (
                              <span
                                key={company}
                                className="companyChip eligibleChip"
                              >
                                {company}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="detailCard">
                          <b>
                            Ineligible companies (
                            {
                              student.ineligibleCompanyCount
                            }
                            )
                          </b>

                          <div className="companyChips">
                            {(
                              student.ineligibleCompanies ||
                              []
                            ).map((company) => (
                              <span
                                key={company}
                                className="companyChip ineligibleChip"
                              >
                                {company}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="detailCard placementCard">
                          <b>Placement history</b>

                          {student.placedCompanyName ? (
                            <p>
                              <span className="placedBadge">
                                ✓ Placed
                              </span>{" "}
                              <strong>
                                {
                                  student.placedCompanyName
                                }
                              </strong>
                            </p>
                          ) : (
                            <p className="muted">
                              No placement recorded.
                            </p>
                          )}
                        </div>

                        <div className="detailCard scheduleCard">
                          <b>
                            Interview schedule & status
                          </b>

                          {(student.interviewDetails ||
                            []).length ? (
                            <div className="studentInterviewList">
                              {student.interviewDetails.map(
                                (interview) => (
                                  <div
                                    className="studentInterviewRow"
                                    key={interview._id}
                                  >
                                    <div>
                                      <strong>
                                        {
                                          interview.company
                                        }
                                      </strong>

                                      <span>
                                        {
                                          interview.statusLabel
                                        }
                                      </span>
                                    </div>

                                    <div>
                                      <b>
                                        Day{" "}
                                        {
                                          interview.day
                                        }
                                      </b>

                                      <span>
                                        {
                                          interview.time
                                        }
                                      </span>
                                    </div>

                                    <div>
                                      <b>
                                        {interview.room ||
                                          "—"}
                                      </b>

                                      <span>
                                        Panel{" "}
                                        {interview.panel ||
                                          "—"}

                                        {interview
                                          .interviewers
                                          ?.length
                                          ? ` · ${interview.interviewers.join(
                                            " + "
                                          )}`
                                          : ""}
                                      </span>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          ) : (
                            <div className="empty compactEmpty">
                              No interview records for
                              this student.
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Disruptions({
  open,
  history,
  rooms,
  setRoomStatus,
}) {
  return (
    <section className="panel disruption">
      <div className="disruptionTop">
        <div>
          <div className="eyebrow">
            LIVE DEFENSE MODE
          </div>

          <h2>Disruption simulator</h2>

          <p>
            A disruption changes an already-created
            schedule. The result shows affected,
            rescheduled, cannot-reschedule.
          </p>
        </div>

        <button onClick={() => open("company_delay")}>
          <Zap size={16} />
          Create disruption
        </button>
      </div>

      <div className="scenarioGrid">
        {[
          [
            "Company delay",
            "Shift the company start window.",
            Building2,
          ],
          [
            "Panel dropout",
            "Remove one panel and reassign interviews.",
            PanelTop,
          ],
          [
            "Student withdrawal",
            "Remove the student from future interviews.",
            Users,
          ],
          [
            "Room unavailable",
            "Take a room out of service.",
            DoorOpen,
          ],
        ].map(([title, description, Icon]) => {
          const type =
            title === "Company delay"
              ? "company_delay"
              : title === "Panel dropout"
                ? "panel_drop"
                : title === "Student withdrawal"
                  ? "student_withdrawal"
                  : "room_unavailable";

          return (
            <div key={title}>
              <Icon />
              <b>{title}</b>
              <p>{description}</p>

              <button
                className="mini"
                onClick={() => open(type)}
              >
                Test
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel roomControl">
        <Head
          title="Room availability control"
          sub="Only availability is controlled here. Bandwidth has been removed."
        />

        <div className="roomGrid">
          {rooms
            .filter(
              (room) => room.status === "unavailable"
            )
            .map((room) => (
              <div
                key={room._id}
                className="roomCard"
              >
                <div>
                  <b>{room.name}</b>
                  <small>{room.floor}</small>
                </div>

                <Status status="Unavailable" />

                <button
                  className="mini"
                  onClick={() =>
                    setRoomStatus(
                      room._id,
                      "available"
                    )
                  }
                >
                  Make available
                </button>
              </div>
            ))}

          {!rooms.some(
            (room) => room.status === "unavailable"
          ) && (
              <div className="empty">
                No unavailable rooms.
              </div>
            )}
        </div>
      </div>

      <div className="history">
        <Head
          title="Recent disruption history"
          sub="Full event messages are stored and displayed after each action."
        />

        <div className="historyList">
          {history.length ? (
            history.map((item) => (
              <div key={item._id}>
                <span>
                  <History size={15} />

                  <b>
                    {String(item.type || "")
                      .replaceAll("_", " ")}
                  </b>
                </span>

                <span>
                  {item.affectedCount ?? 0} affected ·{" "}
                  {item.movedCount ?? 0} moved ·{" "}
                  {item.unscheduledCount ?? 0} unscheduled
                </span>

                <small>{item.summary}</small>

                <details>
                  <summary>
                    View full action log
                  </summary>

                  {(item.details || []).map(
                    (detail, index) => (
                      <p key={index}>{detail}</p>
                    )
                  )}
                </details>
              </div>
            ))
          ) : (
            <div className="empty">
              No disruptions yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DisruptionWithdrawalModal({
  student,
  students = [],
  selectStudent,
  companies,
  close,
  process,
  result,
  loading = false,
}) {
  const shortlisted = useMemo(() => {
    if (!student) return [];

    return companies.filter((company) =>
      (student.shortlistedCompanies || []).includes(
        company.name
      )
    );
  }, [student, companies]);

  const scheduledNames = useMemo(
    () =>
      new Set(student?.scheduledCompanyNames || []),
    [student]
  );

  const scheduledShortlisted = shortlisted.filter(
    (company) =>
      scheduledNames.has(company.name)
  );

  const hasScheduled =
    scheduledShortlisted.length > 0;

  const [step, setStep] = useState(1);
  const [companyId, setCompanyId] = useState("");

  const selected = shortlisted.find(
    (company) => company._id === companyId
  );

  const reset = () => {
    setCompanyId("");
  };

  const label = (company) =>
    `${company.name} · ${scheduledNames.has(company.name)
      ? "✓ Scheduled"
      : "○ Shortlisted · Not scheduled"
    }`;

  useEffect(() => {
    setStep(1);
    setCompanyId("");
  }, [student?._id]);

  if (result) {
    return (
      <WithdrawalOutcome
        result={result}
        close={close}
      />
    );
  }

  if (!student) {
    return (
      <div className="overlay">
        <div className="modal withdrawalModal">
          <div className="modalHeader">
            <div>
              <div className="eyebrow">
                STUDENT WITHDRAWAL
              </div>

              <h2>Select a student</h2>

              <p>
                Choose a student to view all
                shortlisted companies and their
                current schedule status.
              </p>
            </div>

            <button
              className="close"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>

          <label>
            Student

            <select
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  selectStudent(event.target.value);
                }
              }}
            >
              <option value="">
                Select student...
              </option>

              {students
                .filter(
                  (item) =>
                    ![
                      "Withdrawn",
                      "Placed",
                      "Withdrawn + Placed",
                    ].includes(item.status)
                )
                .map((item) => (
                  <option
                    key={item._id}
                    value={item._id}
                  >
                    {item.studentCode} · {item.name} ·{" "}
                    {item.branch} · CGPA {item.cgpa}
                  </option>
                ))}
            </select>
          </label>

          <div className="modalActions">
            <button
              className="ghost"
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="modal withdrawalModal">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">
              STUDENT WITHDRAWAL
            </div>

            <h2>{student.name}</h2>

            <p>
              {student.studentCode} ·{" "}
              {student.branch} · CGPA {student.cgpa}
            </p>
          </div>

          <button
            className="close"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="withdrawSummary">
          <span>
            Shortlisted <b>{shortlisted.length}</b>
          </span>

          <span>
            Scheduled{" "}
            <b>{scheduledShortlisted.length}</b>
          </span>

          <span>
            Upcoming to withdraw{" "}
            <b>{scheduledShortlisted.length}</b>
          </span>
        </div>

        <div className="companyStatusList">
          {shortlisted.map((company) => {
            const scheduled =
              scheduledNames.has(company.name);

            return (
              <div
                key={company._id}
                className={
                  scheduled
                    ? "companyStatus scheduled"
                    : "companyStatus disabled"
                }
              >
                <span>
                  {scheduled ? "✓" : "○"}
                </span>

                <div>
                  <b>{company.name}</b>

                  <small>
                    {scheduled
                      ? "Shortlisted + Scheduled · selectable"
                      : "Shortlisted + Not scheduled · not selectable"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>

        {!hasScheduled && (
          <>
            <div className="noScheduleNotice">
              <div className="noticeIcon">
                <CalendarDays size={20} />
              </div>

              <div>
                <b>No scheduled interview</b>

                <p>
                  Sorry, we have not scheduled an
                  interview for this student. There
                  are no upcoming interviews or
                  schedules to withdraw from.
                </p>
              </div>
            </div>

            <div className="modalActions">
              <button
                className="ghost"
                onClick={close}
              >
                Close
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 1 && (
          <>
            <h3>
              Have you received any offer letter?
            </h3>

            <div className="choiceRow">
              <button
                onClick={() => {
                  reset();
                  setStep(2);
                }}
              >
                Yes
              </button>

              <button
                className="ghost"
                onClick={() => {
                  reset();
                  setStep(3);
                }}
              >
                No
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 2 && (
          <>
            <h3>
              Which shortlisted company gave the
              offer?
            </h3>

            <label>
              Select company

              <select
                value={companyId}
                onChange={(event) =>
                  setCompanyId(event.target.value)
                }
              >
                <option value="">
                  Select company...
                </option>

                {shortlisted.map((company) => (
                  <option
                    key={company._id}
                    value={company._id}
                    disabled={
                      !scheduledNames.has(
                        company.name
                      )
                    }
                  >
                    {label(company)}
                  </option>
                ))}
              </select>
            </label>

            <p className="selectHint">
              All shortlisted companies are shown.
              Only scheduled companies are
              selectable.
            </p>

            <div className="modalActions">
              <button
                className="ghost"
                onClick={() => {
                  reset();
                  setStep(1);
                }}
              >
                Back
              </button>

              <button
                disabled={
                  !companyId ||
                  !scheduledNames.has(
                    selected?.name
                  )
                }
                onClick={() => setStep(4)}
              >
                Confirm
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 3 && (
          <>
            <h3>
              Have you attended an interview with
              any shortlisted company?
            </h3>

            <label>
              Select company

              <select
                value={companyId}
                onChange={(event) =>
                  setCompanyId(event.target.value)
                }
              >
                <option value="">
                  Select company...
                </option>

                {shortlisted.map((company) => (
                  <option
                    key={company._id}
                    value={company._id}
                    disabled={
                      !scheduledNames.has(
                        company.name
                      )
                    }
                  >
                    {label(company)}
                  </option>
                ))}

                <option value="none">
                  None
                </option>
              </select>
            </label>

            <p className="selectHint">
              Only scheduled shortlisted companies
              are selectable. If none was attended,
              choose None.
            </p>

            <div className="modalActions">
              <button
                className="ghost"
                onClick={() => {
                  reset();
                  setStep(1);
                }}
              >
                Back
              </button>

              <button
                disabled={!companyId}
                onClick={() => setStep(5)}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 4 && (
          <>
            <div className="successBox">
              🎉 Congratulations!

              <b>
                You have received an offer from{" "}
                {selected?.name}.
              </b>
            </div>

            <h3>
              Do you want to withdraw from your
              remaining interviews?
            </h3>

            <div className="choiceRow">
              <button
                disabled={loading}
                onClick={() =>
                  process(
                    "withdrawn_placed",
                    companyId
                  )
                }
              >
                Yes
              </button>

              <button
                className="ghost"
                disabled={loading}
                onClick={() => setStep(6)}
              >
                No
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 5 && (
          <>
            <p>
              You attended the{" "}
              <b>
                {companyId === "none"
                  ? "selected interview"
                  : selected?.name}
              </b>
              .
            </p>

            <h3>
              Are you not interested in attending
              the upcoming interviews?
            </h3>

            <div className="choiceRow">
              <button
                disabled={loading}
                onClick={() =>
                  process(
                    "withdrawn",
                    companyId === "none"
                      ? null
                      : companyId
                  )
                }
              >
                Yes
              </button>

              <button
                className="ghost"
                disabled={loading}
                onClick={() => setStep(6)}
              >
                No
              </button>
            </div>
          </>
        )}

        {hasScheduled && step === 6 && (
          <>
            <div className="successBox">
              <b>Great! No changes were made.</b>
              <span>
                You will remain in the placement
                process.
              </span>
            </div>

            <div className="modalActions">
              <button onClick={close}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WithdrawalOutcome({ result, close }) {
  return (
    <div className="overlay">
      <div className="modal wide">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">
              WITHDRAWAL COMPLETE
            </div>

            <h2>Withdrawal processed</h2>

            <p>{result?.message}</p>
          </div>

          <button
            className="close"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <h3>Cancelled interviews</h3>

        <div className="outcomeList">
          {(result?.cancelledInterviews || []).map(
            (item, index) => (
              <div key={index}>
                <b>{item.company}</b>

                <span>
                  Day {item.day} ·{" "}
                  {tm(item.startMinute)}–
                  {tm(item.endMinute)} ·{" "}
                  {item.room} · Panel {item.panel}
                </span>
              </div>
            )
          )}

          {!result?.cancelledInterviews?.length && (
            <p>
              No scheduled interviews were cancelled.
            </p>
          )}
        </div>

        <h3>Replacement students</h3>

        <div className="outcomeList">
          {(result?.replacementStudents || []).map(
            (item, index) => (
              <div key={index}>
                <b>
                  {item.studentCode} ·{" "}
                  {item.student}
                </b>

                <span>
                  {item.company} · Day {item.day} ·{" "}
                  {tm(item.startMinute)}–
                  {tm(item.endMinute)} ·{" "}
                  {item.room} · Panel {item.panel}
                </span>
              </div>
            )
          )}

          {!result?.replacementStudents?.length && (
            <p>
              No replacement student was needed.
            </p>
          )}
        </div>

        <div className="modalActions">
          <button onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Modal({
  form,
  setForm,
  companies,
  students,
  rooms,
  result,
  loading,
  run,
  close,
}) {
  const options =
    form.type === "student_withdrawal"
      ? students
      : form.type === "room_unavailable"
        ? rooms
        : companies;

  const company = companies.find(
    (item) => item._id === form.target
  );

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modalHeader">
          <div>
            <div className="eyebrow">
              LIVE DISRUPTION
            </div>

            <h2>
              {String(form.type).replaceAll(
                "_",
                " "
              )}
            </h2>

            <p>
              Select the actual record. The system
              will explain what changed and where
              interviews moved.
            </p>
          </div>

          <button
            className="close"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <label>
          Event

          <select
            value={form.type}
            onChange={(event) =>
              setForm({
                ...form,
                type: event.target.value,
                target: "",
              })
            }
          >
            <option value="company_delay">
              Company arrived late
            </option>

            <option value="panel_drop">
              Panel dropped out
            </option>

            <option value="student_withdrawal">
              Student withdrew
            </option>

            <option value="room_unavailable">
              Room unavailable
            </option>
          </select>
        </label>

        {form.type === "student_withdrawal" ? (
          <label>
            Student

            <select
              value={form.target}
              onChange={(event) =>
                setForm({
                  ...form,
                  target: event.target.value,
                })
              }
            >
              <option value="">
                Select student...
              </option>

              {options
                .filter(
                  (student) =>
                    ![
                      "Withdrawn",
                      "Placed",
                      "Withdrawn + Placed",
                    ].includes(student.status)
                )
                .map((student) => (
                  <option
                    key={student._id}
                    value={student._id}
                  >
                    {student.studentCode} ·{" "}
                    {student.name} ·{" "}
                    {student.branch} · CGPA{" "}
                    {student.cgpa}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label>
            Target

            <select
              value={form.target}
              onChange={(event) =>
                setForm({
                  ...form,
                  target: event.target.value,
                })
              }
            >
              <option value="">
                Select target...
              </option>

              {options.map((item) => (
                <option
                  key={item._id}
                  value={item._id}
                >
                  {form.type ===
                    "room_unavailable"
                    ? `${item.name} · ${item.floor} · ${item.status}`
                    : `${item.name} · Day ${item.day} · ${item.shortlistCount || 0} shortlisted`}
                </option>
              ))}
            </select>
          </label>
        )}

        {form.type === "company_delay" && (
          <label>
            Delay (hours)

            <input
              type="number"
              min="0.5"
              step="0.5"
              value={form.hours}
              onChange={(event) =>
                setForm({
                  ...form,
                  hours: event.target.value,
                })
              }
            />
          </label>
        )}

        {form.type === "panel_drop" &&
          company && (
            <label>
              Panel

              <select
                value={form.panel}
                onChange={(event) =>
                  setForm({
                    ...form,
                    panel: event.target.value,
                  })
                }
              >
                {(
                  company.panelDetails || []
                )
                  .filter(
                    (panel) =>
                      !(
                        company.blockedPanels ||
                        []
                      ).includes(panel.number)
                  )
                  .map((panel) => (
                    <option
                      key={panel.number}
                      value={panel.number}
                    >
                      Panel {panel.number} —{" "}
                      {panel.interviewers?.join(
                        " + "
                      )}
                    </option>
                  ))}
              </select>
            </label>
          )}

        {form.type === "room_unavailable" && (
          <label>
            Room action

            <select
              value={form.roomAction}
              onChange={(event) =>
                setForm({
                  ...form,
                  roomAction: event.target.value,
                })
              }
            >
              <option value="unavailable">
                Make unavailable
              </option>

              <option value="available">
                Make available
              </option>
            </select>
          </label>
        )}

        <div className="modalActions">
          <button
            className="ghost"
            onClick={close}
          >
            Cancel
          </button>

          <button
            onClick={run}
            disabled={
              loading || !form.target
            }
          >
            {loading
              ? "Replanning..."
              : "Apply disruption & replan"}
          </button>
        </div>

        {result && <Result result={result} />}
      </div>
    </div>
  );
}

function Result({ result }) {
  return (
    <div className="result">
      <div className="resultSummary">
        <b>{result?.message}</b>
      </div>

      <div className="countGrid">
        <span>
          <b>{result?.affectedCount ?? 0}</b>
          {result?.roomStatus === "available" ? "Recovered" : "Affected"}
        </span>

        <span>
          <b>
            {result?.rescheduledCount ??
              result?.movedCount ??
              0}
          </b>
          {result?.roomStatus === "available" ? "Recovered from queue" : "Rescheduled"}
        </span>

        <span>
          <b>
            {result?.roomStatus === "available"
              ? result?.unscheduledAfter ?? 0
              : result?.cannotRescheduleCount ?? 0}
          </b>
          {result?.roomStatus === "available"
            ? "Remaining unscheduled"
            : "Cannot reschedule"}
        </span>

        {/* <span>
          <b>
            {result?.scheduledBefore ?? "—"} →{" "}
            {result?.scheduledAfter ?? "—"}
          </b>
          Scheduled
        </span>

        <span>
          <b>
            {result?.unscheduledBefore ?? "—"} →{" "}
            {result?.unscheduledAfter ??
              result?.unscheduledCount ??
              "—"}
          </b>
          Unscheduled
        </span> */}
      </div>

      <div className="detailLog">
        {(result?.details || []).map(
          (detail, index) => (
            <div key={index}>
              <CheckCircle2 size={13} />
              {detail}
            </div>
          )
        )}
      </div>

      {(result?.moved || []).length > 0 && (
        <div className="movement">
          <b>
            Rescheduled appointments — old vs new
            interviewer and room
          </b>

          {result.moved.map((movement, index) => (
            <div key={index}>
              <span>
                <b>{movement.studentCode}</b>{" "}
                {movement.student}
              </span>

              <span>{movement.company}</span>

              <span>
                D{movement.from.day}{" "}
                {tm(
                  movement.from.startMinute
                )}{" "}
                · {movement.from.room} · P
                {movement.from.panel} (
                {movement.from.interviewers?.join(
                  " + "
                ) || "—"}
                )

                {" → "}

                D{movement.to.day}{" "}
                {tm(
                  movement.to.startMinute
                )}{" "}
                · {movement.to.room} · P
                {movement.to.panel} (
                {movement.to.interviewers?.join(
                  " + "
                ) || "—"}
                )

                <small>
                  {movement.message}
                </small>
              </span>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({
  title,
  q,
  setQ,
  placeholder,
}) {
  return (
    <div className="toolbar">
      <div>
        <div className="eyebrow">DIRECTORY</div>
        <h2>{title}</h2>
      </div>

      <div className="search">
        <Search size={16} />

        <input
          value={q}
          onChange={(event) =>
            setQ(event.target.value)
          }
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);