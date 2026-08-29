import express from "express";

import Company from "../models/Company.js";
import Student from "../models/Student.js";
import Room from "../models/Room.js";
import Shortlist from "../models/Shortlist.js";
import Interview from "../models/Interview.js";
import Disruption from "../models/Disruption.js";
import ScheduleConfig from "../models/ScheduleConfig.js";

import { generateData } from "../utils/generator.js";

import {
  buildSchedule,
  getSchedule,
  STUDENT_BUFFER,
  replanRoomAffected,
  recoverRoomCapacity
} from "../services/scheduler.js";

const router = express.Router();

/* =========================================================
   HELPERS
========================================================= */

router.get("/health", (_, res) => {
  res.json({
    ok: true,
    bufferMinutes: STUDENT_BUFFER
  });
});

function minutes(m) {
  if (m == null) return "--:--";

  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
    m % 60
  ).padStart(2, "0")}`;
}

/*
  IMPORTANT:

  Scheduled count = actual scheduled Interview documents.

  Unscheduled count = active eligible shortlist opportunities
                       that do not currently have a scheduled interview.

  This means when 56 interviews become impossible:

      scheduled:   2108 -> 2052
      unscheduled:  567 -> 623

  No artificial percentage/count is stored in memory.
  Everything comes from MongoDB.
*/

async function activeShortlistCount() {
  const rows = await Shortlist.aggregate([
    {
      $lookup: {
        from: "students",
        localField: "studentId",
        foreignField: "_id",
        as: "student"
      }
    },
    {
      $unwind: "$student"
    },
    {
      $match: {
        "student.status": "Eligible"
      }
    },
    {
      $count: "count"
    }
  ]);

  return rows[0]?.count || 0;
}

/* =========================================================
   STUDENT VIEW
========================================================= */

async function studentView(s) {
  const companies = await Company.find()
    .sort({ name: 1 })
    .lean();

  const shortlisted = await Shortlist.find({
    studentId: s._id
  })
    .populate("companyId", "name cgpaCutoff")
    .lean();

  const interviews = await Interview.find({
    studentId: s._id
  })
    .populate("companyId", "name panelDetails")
    .populate("roomId", "name")
    .lean();

  const eligible = companies.filter(
    c => s.cgpa >= c.cgpaCutoff
  );

  const ineligible = companies.filter(
    c => s.cgpa < c.cgpaCutoff
  );

  const activeShortlisted = shortlisted
    .map(x => x.companyId?.name)
    .filter(Boolean);

  const historicalShortlisted =
    s.shortlistedCompanySnapshot || [];

  const displayShortlisted = activeShortlisted.length
    ? [...new Set(activeShortlisted)]
    : [...new Set(historicalShortlisted)];

  const scheduledInterviews = interviews.filter(
    x => x.status === "scheduled"
  );

  const placedCompany = s.placedCompanyId
    ? await Company.findById(s.placedCompanyId)
      .select("name")
      .lean()
    : null;

  return {
    ...s,

    eligibleCompanyCount: eligible.length,
    eligibleCompanies: eligible.map(c => c.name),

    ineligibleCompanyCount: ineligible.length,
    ineligibleCompanies: ineligible.map(c => c.name),

    shortlistedCompanyCount:
      displayShortlisted.length,

    shortlistedCompanies:
      displayShortlisted,

    activeShortlistedCompanyCount:
      activeShortlisted.length,

    scheduledInterviewCount:
      scheduledInterviews.length,

    scheduledCompanyNames: [
      ...new Set(
        scheduledInterviews
          .map(x => x.companyId?.name)
          .filter(Boolean)
      )
    ],

    withdrawnInterviewCount:
      interviews.filter(
        x => x.status === "withdrawn"
      ).length,

    cancelledInterviewCount:
      interviews.filter(
        x => x.status === "cancelled"
      ).length,

    placedCompanyName:
      placedCompany?.name || null,

    interviewDetails: interviews
      .sort(
        (a, b) =>
          (a.day || 0) - (b.day || 0) ||
          (a.startMinute || 0) -
          (b.startMinute || 0)
      )
      .map(x => {
        const panel = (
          x.companyId?.panelDetails || []
        ).find(
          p => p.number === x.panel
        );

        return {
          _id: x._id,

          company:
            x.companyId?.name ||
            "Unknown company",

          day: x.day,

          startMinute:
            x.startMinute,

          endMinute:
            x.endMinute,

          time:
            `${minutes(
              x.startMinute
            )}–${minutes(x.endMinute)}`,

          room:
            x.roomId?.name || null,

          panel:
            x.panel,

          interviewers:
            panel?.interviewers || [],

          status:
            x.status,

          statusLabel:
            x.status === "scheduled"
              ? "Scheduled"
              : x.status === "withdrawn"
                ? "Withdrawn"
                : "Cancelled"
        };
      })
  };
}

/* =========================================================
   SCHEDULE STATISTICS
========================================================= */

async function scheduleStats() {
  const [
    activeShortlists,
    scheduledRows,
    rooms,
    disruptions,
    config
  ] = await Promise.all([
    activeShortlistCount(),

    Interview.find({
      status: "scheduled"
    }).lean(),

    Room.find().lean(),

    Disruption.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),

    ScheduleConfig.findOne()
      .sort({ createdAt: -1 })
      .lean()
  ]);

  /*
    REAL COUNTS
  */

  const scheduled =
    scheduledRows.length;

  const unscheduled =
    Math.max(
      0,
      activeShortlists - scheduled
    );

  const scheduledPct =
    activeShortlists
      ? Number(
        (
          (scheduled /
            activeShortlists) *
          100
        ).toFixed(1)
      )
      : 0;

  const unscheduledPct =
    activeShortlists
      ? Number(
        (
          (unscheduled /
            activeShortlists) *
          100
        ).toFixed(1)
      )
      : 0;

  /* =======================================================
     STUDENT CLASHES
  ======================================================= */

  const studentGroups =
    new Map();

  for (const x of scheduledRows) {
    const key =
      `${x.studentId}-${x.day}`;

    if (!studentGroups.has(key)) {
      studentGroups.set(
        key,
        []
      );
    }

    studentGroups
      .get(key)
      .push(x);
  }

  let studentClashes = 0;

  let averageWaitingMinutes = 0;

  let waitingSamples = 0;

  for (
    const list of studentGroups.values()
  ) {
    list.sort(
      (a, b) =>
        a.startMinute -
        b.startMinute
    );

    for (
      let i = 1;
      i < list.length;
      i++
    ) {
      const prev =
        list[i - 1];

      const cur =
        list[i];

      const gap =
        cur.startMinute -
        prev.endMinute;

      if (
        gap < STUDENT_BUFFER
      ) {
        studentClashes++;
      }

      if (gap >= 0) {
        averageWaitingMinutes +=
          gap;

        waitingSamples++;
      }
    }
  }

  averageWaitingMinutes =
    waitingSamples
      ? Math.round(
        averageWaitingMinutes /
        waitingSamples
      )
      : 0;

  /* =======================================================
     ROOM UTILISATION
  ======================================================= */

  const usedRoomIds =
    new Set(
      scheduledRows.map(
        x => String(x.roomId)
      )
    );

  const availableRooms =
    rooms.filter(
      r => r.status === "available"
    ).length;

  const roomUtilisation =
    rooms.length
      ? Math.round(
        (availableRooms /
          rooms.length) *
        100
      )
      : 0;

  /* =======================================================
     REPLAN CHURN
  ======================================================= */

  const movedTotal =
    disruptions.reduce(
      (n, d) =>
        n +
        (Number(d.movedCount) ||
          0),
      0
    );

  const replanChurn =
    scheduled
      ? Number(
        (
          (movedTotal /
            scheduled) *
          100
        ).toFixed(1)
      )
      : 0;

  /* =======================================================
     ROOM CONFLICTS
  ======================================================= */

  const roomEvents =
    new Map();

  for (const x of scheduledRows) {
    const key =
      `${x.day}-${x.roomId}`;

    if (!roomEvents.has(key)) {
      roomEvents.set(
        key,
        []
      );
    }

    roomEvents
      .get(key)
      .push(x);
  }

  let roomConflicts = 0;

  for (
    const [
      key,
      events
    ] of roomEvents
  ) {
    const room =
      rooms.find(
        r =>
          String(r._id) ===
          String(
            events[0].roomId
          )
      );

    const maxPanels =
      Math.max(
        1,
        Math.min(
          4,
          Number(
            room?.maxPanels
          ) || 4
        )
      );

    const maxCandidates =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            room?.maxCandidatesPerDay ||
            room?.capacity
          ) || 100
        )
      );

    if (
      events.length >
      maxCandidates
    ) {
      roomConflicts++;
    }

    const points = [];

    for (const e of events) {
      points.push({
        t: e.startMinute,
        type: 1,
        stream:
          `${e.companyId}-${e.panel}`
      });

      points.push({
        t: e.endMinute,
        type: -1,
        stream:
          `${e.companyId}-${e.panel}`
      });
    }

    points.sort(
      (a, b) =>
        a.t - b.t ||
        a.type - b.type
    );

    const activeStreams =
      new Set();

    for (
      const point of points
    ) {
      if (point.type === -1) {
        activeStreams.delete(
          point.stream
        );
      } else {
        activeStreams.add(
          point.stream
        );

        if (
          activeStreams.size >
          maxPanels
        ) {
          roomConflicts++;
          break;
        }
      }
    }
  }

  /* =======================================================
     PANEL CONFLICTS
  ======================================================= */

  const panelBookings =
    new Map();

  let panelConflicts = 0;

  for (const x of scheduledRows) {
    const key =
      `${x.day}-${x.companyId}-${x.panel}`;

    const arr =
      panelBookings.get(key) ||
      [];

    if (
      arr.some(
        a =>
          a.startMinute <
          x.endMinute &&
          x.startMinute <
          a.endMinute
      )
    ) {
      panelConflicts++;
    }

    arr.push(x);

    panelBookings.set(
      key,
      arr
    );
  }

  const upcomingConflicts =
    studentClashes +
    roomConflicts +
    panelConflicts;

  const dayCounts =
    [1, 2, 3, 4].map(
      day => ({
        day,
        count:
          scheduledRows.filter(
            x =>
              x.day === day
          ).length
      })
    );

  const healthStatus =
    upcomingConflicts === 0
      ? "Healthy"
      : "Needs attention";

  return {
    activeShortlists,

    scheduled,

    unscheduled,

    scheduledPct,

    unscheduledPct,

    targetPercent:
      config?.targetPercent ||
      null,

    targetInterviewCount:
      config?.targetInterviewCount ||
      null,

    readiness:
      Math.round(
        scheduledPct
      ),

    studentClashes,

    roomConflicts,

    panelConflicts,

    upcomingConflicts,

    roomsInUse:
      usedRoomIds.size,

    availableRooms,

    roomUtilisation,

    averageWaitingMinutes,

    replanChurn,

    dayCounts,

    healthStatus
  };
}

/* =========================================================
   SUMMARY
========================================================= */

router.get(
  "/summary",
  async (_, res) => {
    try {
      const [
        companies,
        students,
        rooms,
        unavailable,
        withdrawn,
        placed,
        stats
      ] = await Promise.all([
        Company.countDocuments(),

        Student.countDocuments(),

        Room.countDocuments(),

        Room.countDocuments({
          status: "unavailable"
        }),

        Student.countDocuments({
          status: {
            $in: [
              "Withdrawn",
              "Withdrawn + Placed"
            ]
          }
        }),

        Student.countDocuments({
          status: {
            $in: [
              "Placed",
              "Withdrawn + Placed"
            ]
          }
        }),

        scheduleStats()
      ]);

      res.json({
        companies,

        students,

        rooms,

        shortlisted:
          stats.activeShortlists,

        scheduled:
          stats.scheduled,

        unscheduled:
          stats.unscheduled,

        scheduledPct:
          stats.scheduledPct,

        unscheduledPct:
          stats.unscheduledPct,

        unavailableRooms:
          unavailable,

        withdrawnStudents:
          withdrawn,

        placedStudents:
          placed,

        bufferMinutes:
          STUDENT_BUFFER,

        readiness:
          stats.readiness,

        studentClashes:
          stats.studentClashes,

        roomConflicts:
          stats.roomConflicts,

        panelConflicts:
          stats.panelConflicts,

        upcomingConflicts:
          stats.upcomingConflicts,

        roomsInUse:
          stats.roomsInUse,

        availableRooms:
          stats.availableRooms,

        roomUtilisation:
          stats.roomUtilisation,

        averageWaitingMinutes:
          stats.averageWaitingMinutes,

        replanChurn:
          stats.replanChurn,

        dayCounts:
          stats.dayCounts,

        healthStatus:
          stats.healthStatus,

        targetPercent:
          stats.targetPercent,

        targetInterviewCount:
          stats.targetInterviewCount
      });
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   GENERATE / RESET
========================================================= */

router.post(
  "/seed",
  async (_, res) => {
    try {
      const data =
        await generateData();

      let result = null;

      for (
        let attempt = 1;
        attempt <= 6;
        attempt++
      ) {
        result =
          await buildSchedule();

        const pct =
          data.shortlists
            ? (
              result.scheduled.length /
              data.shortlists
            ) * 100
            : 0;

        if (
          pct > 60 &&
          pct <= 70
        ) {
          break;
        }
      }

      const finalPct =
        data.shortlists
          ? (
            result.scheduled.length /
            data.shortlists
          ) * 100
          : 0;

      if (
        !(
          finalPct > 60 &&
          finalPct <= 70
        )
      ) {
        throw new Error(
          `The generated schedule reached ${finalPct.toFixed(
            1
          )}%, but Generate requires more than 60% and up to 70%. Please Generate again.`
        );
      }

      res.json({
        ...data,

        scheduled:
          result.scheduled.length,

        unscheduled:
          result.unscheduled.length,

        scheduledPct:
          Number(
            finalPct.toFixed(1)
          ),

        unscheduledPct:
          Number(
            (
              100 - finalPct
            ).toFixed(1)
          )
      });
    } catch (e) {
      console.error(
        "SEED FAILED:",
        e.stack || e
      );

      res.status(500).json({
        message:
          `Generate / Reset failed: ${e.message}`
      });
    }
  }
);

/* =========================================================
   NORMAL SCHEDULE
========================================================= */

router.post(
  "/schedule",
  async (_, res) => {
    try {
      const result =
        await buildSchedule();

      res.json({
        scheduled:
          result.scheduled.length,

        unscheduled:
          result.unscheduled.length,

        unscheduledItems:
          result.unscheduled.slice(
            0,
            100
          )
      });
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   COMPANIES
========================================================= */

router.get(
  "/companies",
  async (_, res) => {
    try {
      const companies =
        await Company.find()
          .sort({
            day: 1,
            priority: 1,
            name: 1
          })
          .lean();

      const out =
        await Promise.all(
          companies.map(
            async c => {
              const [
                ss,
                placed
              ] =
                await Promise.all([
                  Shortlist.find({
                    companyId:
                      c._id
                  })
                    .populate(
                      "studentId",
                      "studentCode name branch cgpa status"
                    )
                    .limit(800)
                    .lean(),

                  Student.find({
                    placedCompanyId:
                      c._id
                  })
                    .sort({
                      studentCode: 1
                    })
                    .lean()
                ]);

              return {
                ...c,

                shortlistedStudents:
                  ss
                    .map(
                      x =>
                        x.studentId
                    )
                    .filter(Boolean),

                placedStudents:
                  placed
              };
            }
          )
        );

      res.json(out);
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   STUDENTS
========================================================= */

router.get(
  "/students",
  async (req, res) => {
    try {
      const q =
        (req.query.q || "")
          .trim();

      const filter = q
        ? {
          $or: [
            {
              name: {
                $regex: q,
                $options: "i"
              }
            },
            {
              studentCode: {
                $regex: q,
                $options: "i"
              }
            },
            {
              branch: {
                $regex: q,
                $options: "i"
              }
            },
            {
              status: {
                $regex: q,
                $options: "i"
              }
            }
          ]
        }
        : {};

      const limit =
        Math.min(
          Number(
            req.query.limit ||
            800
          ),
          800
        );

      const list =
        await Student.find(
          filter
        )
          .sort({
            studentCode: 1
          })
          .limit(limit)
          .lean();

      res.json(
        await Promise.all(
          list.map(studentView)
        )
      );
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

router.get(
  "/students/:id",
  async (req, res) => {
    try {
      const s =
        await Student.findById(
          req.params.id
        ).lean();

      if (!s) {
        return res
          .status(404)
          .json({
            message:
              "Student not found"
          });
      }

      res.json(
        await studentView(s)
      );
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   UNSCHEDULED STUDENTS
========================================================= */

router.get(
  "/unscheduled-students",
  async (_, res) => {
    try {
      const [
        shortlists,
        scheduled
      ] = await Promise.all([
        Shortlist.find()
          .populate(
            "studentId",
            "studentCode name branch cgpa status"
          )
          .populate(
            "companyId",
            "name"
          )
          .lean(),

        Interview.find({
          status: "scheduled"
        })
          .select(
            "studentId companyId"
          )
          .lean()
      ]);

      const scheduledPairs =
        new Set(
          scheduled.map(
            x =>
              `${String(
                x.studentId
              )}-${String(
                x.companyId
              )}`
          )
        );

      const byStudent =
        new Map();

      for (
        const row of shortlists
      ) {
        if (
          !row.studentId ||
          !row.companyId
        ) {
          continue;
        }

        if (
          row.studentId.status &&
          row.studentId.status !==
          "Eligible"
        ) {
          continue;
        }

        const studentId =
          String(
            row.studentId._id
          );

        const companyId =
          String(
            row.companyId._id
          );

        if (
          scheduledPairs.has(
            `${studentId}-${companyId}`
          )
        ) {
          continue;
        }

        if (
          !byStudent.has(
            studentId
          )
        ) {
          byStudent.set(
            studentId,
            {
              studentId,

              studentCode:
                row.studentId
                  .studentCode,

              name:
                row.studentId
                  .name,

              companies: []
            }
          );
        }

        const item =
          byStudent.get(
            studentId
          );

        if (
          !item.companies.some(
            c =>
              String(c._id) ===
              companyId
          )
        ) {
          item.companies.push({
            _id:
              companyId,

            name:
              row.companyId.name
          });
        }
      }

      const result =
        [...byStudent.values()]
          .sort(
            (a, b) =>
              String(
                a.studentCode
              ).localeCompare(
                String(
                  b.studentCode
                )
              )
          )
          .map(x => ({
            ...x,

            unscheduledCompanyNames:
              x.companies.map(
                c => c.name
              )
          }));

      const unscheduledCount =
        result.reduce(
          (n, x) =>
            n +
            (
              x.companies
                ?.length || 0
            ),
          0
        );

      res.json({
        count:
          result.length,

        studentCount:
          result.length,

        unscheduledCount,

        students:
          result
      });
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   STUDENT STATUS
========================================================= */

router.post(
  "/students/:id/status",
  async (req, res) => {
    try {
      const {
        status,
        companyId
      } = req.body;

      const allowed = [
        "Eligible",
        "Withdrawn",
        "Ineligible",
        "Placed",
        "Withdrawn + Placed"
      ];

      if (
        !allowed.includes(status)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid student status."
          });
      }

      const s =
        await Student.findById(
          req.params.id
        );

      if (!s) {
        return res
          .status(404)
          .json({
            message:
              "Student not found"
          });
      }

      const old =
        s.status;

      let affected = 0;

      const currentShortlists =
        await Shortlist.find({
          studentId: s._id
        })
          .populate(
            "companyId",
            "name"
          )
          .lean();

      const currentShortlistNames =
        currentShortlists
          .map(
            x =>
              x.companyId?.name
          )
          .filter(Boolean);

      if (
        currentShortlistNames.length
      ) {
        s.shortlistedCompanySnapshot =
          [
            ...new Set([
              ...(s.shortlistedCompanySnapshot ||
                []),

              ...currentShortlistNames
            ])
          ];
      }

      /* =====================================================
         PLACED
      ===================================================== */

      if (
        status === "Placed" ||
        status ===
        "Withdrawn + Placed"
      ) {
        if (!companyId) {
          return res
            .status(400)
            .json({
              message:
                "Select the company in which the student was placed."
            });
        }

        const shortlisted =
          await Shortlist.exists({
            studentId: s._id,
            companyId
          });

        if (!shortlisted) {
          return res
            .status(400)
            .json({
              message:
                "The selected company must be one of the student's shortlisted companies."
            });
        }

        const company =
          await Company.findById(
            companyId
          ).select("name");

        if (!company) {
          return res
            .status(404)
            .json({
              message:
                "Selected company not found."
            });
        }

        const before =
          await Interview.find({
            studentId: s._id,
            status: "scheduled"
          })
            .populate(
              "companyId",
              "name"
            )
            .populate(
              "roomId",
              "name"
            )
            .lean();

        const scheduleBefore =
          await getSchedule();

        s.status =
          status;

        s.placedCompanyId =
          company._id;

        await s.save();

        const newStatus =
          status ===
            "Withdrawn + Placed"
            ? "withdrawn"
            : "cancelled";

        const reason =
          status ===
            "Withdrawn + Placed"
            ? "Student withdrew after receiving an offer; remaining interviews cancelled."
            : `Student placed with ${company.name}; remaining interviews cancelled.`;

        const releaseRows =
          before
            .filter(
              x =>
                String(
                  x.companyId?._id
                ) !==
                String(
                  company._id
                )
            )
            .map(x => ({
              studentId:
                x.studentId,

              companyId:
                x.companyId,

              roomId:
                x.roomId,

              day:
                x.day,

              panel:
                x.panel,

              startMinute:
                x.startMinute,

              endMinute:
                x.endMinute
            }));

        const r =
          await Interview.updateMany(
            {
              studentId:
                s._id,

              status:
                "scheduled",

              companyId: {
                $ne:
                  company._id
              }
            },
            {
              $set: {
                status:
                  newStatus,

                cancellationReason:
                  reason
              }
            }
          );

        affected =
          r.modifiedCount;

        await Shortlist.deleteMany({
          studentId: s._id
        });

        /*
          Reuse released slots.

          The offered company is NOT released.
        */

        await buildSchedule({
          releasedSlots:
            releaseRows,

          minimumTargetCount:
            Math.max(
              0,
              scheduleBefore.length -
              1
            )
        });

        const after =
          await getSchedule();

        const beforePairs =
          new Set(
            scheduleBefore.map(
              x =>
                `${x.studentId?._id}-${x.companyId?._id}`
            )
          );

        const affectedCompanyIds =
          new Set(
            before.map(
              x =>
                String(
                  x.companyId?._id
                )
            )
          );

        const replacements =
          after
            .filter(
              x =>
                affectedCompanyIds.has(
                  String(
                    x.companyId?._id
                  )
                ) &&
                !beforePairs.has(
                  `${x.studentId?._id}-${x.companyId?._id}`
                )
            )
            .slice(0, 50);

        return res.json({
          message:
            status ===
              "Withdrawn + Placed"
              ? `Great! Your placement has been recorded. Company: ${company.name}. Status: Withdrawn + Placed. Remaining interviews have been withdrawn.`
              : `${s.studentCode} | ${s.name}: ${old} → Placed at ${company.name}. ${affected} remaining interview(s) cancelled and the schedule was rebuilt.`,

          student:
            await studentView(
              s
            ),

          placedCompany:
            company.name,

          affected,

          cancelledInterviews:
            before
              .filter(
                x =>
                  String(
                    x.companyId?._id
                  ) !==
                  String(
                    company._id
                  )
              )
              .map(x => ({
                company:
                  x.companyId
                    ?.name,

                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId?.name,

                panel:
                  x.panel
              })),

          replacementStudents:
            replacements.map(
              x => ({
                studentCode:
                  x.studentId
                    ?.studentCode,

                student:
                  x.studentId
                    ?.name,

                company:
                  x.companyId
                    ?.name,

                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId?.name,

                panel:
                  x.panel
              })
            )
        });
      }

      /* =====================================================
         NORMAL STATUS
      ===================================================== */

      s.status =
        status;

      if (
        status !== "Placed" &&
        status !==
        "Withdrawn + Placed"
      ) {
        s.placedCompanyId =
          null;
      }

      await s.save();

      /* =====================================================
         WITHDRAWN
      ===================================================== */

      if (
        status === "Withdrawn"
      ) {
        const before =
          await Interview.find({
            status: "scheduled"
          }).lean();

        const cancelled =
          before.filter(
            x =>
              String(
                x.studentId
              ) ===
              String(s._id)
          );

        const releaseRows =
          cancelled.map(
            x => ({
              studentId:
                x.studentId,

              companyId:
                x.companyId,

              roomId:
                x.roomId,

              day:
                x.day,

              panel:
                x.panel,

              startMinute:
                x.startMinute,

              endMinute:
                x.endMinute
            })
          );

        const r =
          await Interview.updateMany(
            {
              studentId:
                s._id,

              status:
                "scheduled"
            },
            {
              $set: {
                status:
                  "withdrawn",

                cancellationReason:
                  "Student withdrew from placement."
              }
            }
          );

        affected =
          r.modifiedCount;

        await Shortlist.deleteMany({
          studentId: s._id
        });

        await buildSchedule({
          releasedSlots:
            releaseRows,

          minimumTargetCount:
            Math.max(
              0,
              before.length
            )
        });

        const after =
          await getSchedule();

        const beforeKeys =
          new Set(
            before.map(
              x =>
                `${x.studentId}-${x.companyId}-${x.day}-${x.startMinute}`
            )
          );

        const replacements =
          after
            .filter(
              x =>
                !beforeKeys.has(
                  `${x.studentId?._id}-${x.companyId?._id}-${x.day}-${x.startMinute}`
                )
            )
            .slice(0, 50);

        const cancelledDetails =
          await Interview.find({
            _id: {
              $in:
                cancelled.map(
                  x => x._id
                )
            }
          })
            .populate(
              "companyId",
              "name"
            )
            .populate(
              "roomId",
              "name"
            )
            .lean();

        res.json({
          message:
            `${s.studentCode} | ${s.name}: ${old} → Withdrawn. ${affected} interview(s) cancelled. Replacement students were reconsidered.`,

          student:
            await studentView(
              s
            ),

          affected,

          cancelledInterviews:
            cancelledDetails.map(
              x => ({
                company:
                  x.companyId
                    ?.name,

                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId?.name,

                panel:
                  x.panel
              })
            ),

          replacementStudents:
            replacements.map(
              x => ({
                studentCode:
                  x.studentId
                    ?.studentCode,

                student:
                  x.studentId
                    ?.name,

                company:
                  x.companyId
                    ?.name,

                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId?.name,

                panel:
                  x.panel
              })
            )
        });

        return;
      }

      if (
        status === "Eligible"
      ) {
        await buildSchedule();
      }

      res.json({
        message:
          `${s.studentCode} | ${s.name}: ${old} → ${status}. Schedule rebuilt.`,

        student:
          await studentView(
            s
          ),

        affected
      });
    } catch (e) {
      console.error(
        "STUDENT STATUS FAILED:",
        e.stack || e
      );

      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   ROOMS
========================================================= */

router.get(
  "/rooms",
  async (_, res) => {
    try {
      res.json(
        await Room.find()
          .sort({
            name: 1
          })
          .lean()
      );
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   ROOM ACTION
========================================================= */

async function roomAction(
  id,
  status
) {
  const room =
    await Room.findById(id);

  if (!room) {
    throw new Error(
      "Room not found"
    );
  }

  const before =
    await scheduleStats();

  /*
    ONLY interviews inside this room
    are affected.
  */

  const affected =
    status ===
      "unavailable"
      ? await Interview.find({
        roomId:
          room._id,

        status:
          "scheduled"
      })
        .populate(
          "studentId",
          "studentCode name"
        )
        .populate(
          "companyId",
          "name panelDetails"
        )
        .lean()
      : [];

  room.status =
    status;

  await room.save();

  if (
    status ===
    "unavailable" &&
    affected.length
  ) {
    await Interview.updateMany(
      {
        roomId:
          room._id,

        status:
          "scheduled"
      },
      {
        $set: {
          status:
            "cancelled",

          cancellationReason:
            `${room.name} taken out of service.`
        }
      }
    );
  }

  if (
    status ===
    "unavailable"
  ) {
    await replanRoomAffected(
      affected,
      room._id
    );
  } else {
    await recoverRoomCapacity(
      room._id
    );
  }

  const after =
    await scheduleStats();

  const afterRows =
    await getSchedule();

  const moved =
    affected
      .map(a => {
        const x =
          afterRows.find(
            y =>
              String(
                y.studentId?._id
              ) ===
              String(
                a.studentId?._id
              ) &&
              String(
                y.companyId?._id
              ) ===
              String(
                a.companyId?._id
              )
          );

        if (!x) {
          return null;
        }

        const fromPanel =
          (
            a.companyId
              ?.panelDetails ||
            []
          ).find(
            v =>
              Number(v.number) ===
              Number(a.panel)
          );

        const toPanel =
          (
            x.companyId
              ?.panelDetails ||
            []
          ).find(
            v =>
              Number(v.number) ===
              Number(x.panel)
          );

        const panelChanged =
          Number(a.panel) !==
          Number(x.panel);

        const roomChanged =
          String(a.roomId) !==
          String(
            x.roomId?._id
          );

        const reasons = [];

        if (panelChanged) {
          reasons.push(
            `Panel ${a.panel} was unavailable, so the interview was reassigned to Panel ${x.panel}.`
          );
        }

        if (roomChanged) {
          reasons.push(
            `The interview was moved to ${x.roomId?.name ||
            "another available room"
            } to maintain schedule availability.`
          );
        }

        if (!reasons.length) {
          reasons.push(
            `The interview was reassigned within the available scheduling capacity.`
          );
        }

        return {
          studentCode:
            a.studentId
              ?.studentCode,

          student:
            a.studentId
              ?.name,

          company:
            a.companyId
              ?.name,

          from: {
            day:
              a.day,

            startMinute:
              a.startMinute,

            endMinute:
              a.endMinute,

            room:
              room.name,

            panel:
              a.panel,

            interviewers:
              fromPanel
                ?.interviewers ||
              []
          },

          to: {
            day:
              x.day,

            startMinute:
              x.startMinute,

            endMinute:
              x.endMinute,

            room:
              x.roomId?.name,

            panel:
              x.panel,

            interviewers:
              toPanel
                ?.interviewers ||
              []
          },

          message:
            `${a.studentId?.studentCode} ${a.studentId?.name} → ${a.companyId?.name}: ${minutes(
              a.startMinute
            )} ${room.name} Panel ${a.panel
            } (${fromPanel?.interviewers?.join(
              " + "
            ) || "—"
            }) → ${minutes(
              x.startMinute
            )} ${x.roomId?.name
            } Panel ${x.panel
            } (${toPanel?.interviewers?.join(
              " + "
            ) || "—"
            }). ${reasons.join(
              " "
            )}`
        };
      })
      .filter(Boolean);

  const rescheduled =
    moved.length;

  /*
    IMPORTANT:

    If 77 were affected and only
    21 can be scheduled again:

        cannot = 77 - 21
               = 56

    Therefore:

        scheduledAfter =
          scheduledBefore - 56

        unscheduledAfter =
          unscheduledBefore + 56
  */

  const cannot =
    Math.max(
      0,
      affected.length -
      rescheduled
    );

  const recovered =
    Math.max(
      0,
      after.scheduled -
      before.scheduled
    );

  const message =
    status ===
      "unavailable"
      ? `${room.name} was taken out of service. ${affected.length} appointment(s) were affected; ${rescheduled} were successfully reassigned and ${cannot} could not be placed.`
      : `${room.name} was returned to service. The scheduler reviewed the waiting interview queue and assigned ${recovered} appointment(s) to available capacity.`;

  return {
    room,

    roomStatus:
      status,

    affectedCount:
      status ===
        "unavailable"
        ? affected.length
        : recovered,

    rescheduledCount:
      status ===
        "unavailable"
        ? rescheduled
        : recovered,

    cannotRescheduleCount:
      status ===
        "unavailable"
        ? cannot
        : 0,

    recoveredCount:
      recovered,

    movedCount:
      status ===
        "unavailable"
        ? rescheduled
        : recovered,

    scheduledBefore:
      before.scheduled,

    scheduledAfter:
      after.scheduled,

    unscheduledBefore:
      before.unscheduled,

    unscheduledAfter:
      after.unscheduled,

    scheduled:
      after.scheduled,

    unscheduled:
      after.unscheduled,

    message,

    moved
  };
}

/* =========================================================
   ROOM STATUS API
========================================================= */

router.post(
  "/rooms/:id/status",
  async (req, res) => {
    try {
      const {
        status
      } = req.body;

      if (
        ![
          "available",
          "unavailable"
        ].includes(status)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid room status."
          });
      }

      const out =
        await roomAction(
          req.params.id,
          status
        );

      const record =
        await Disruption.create({
          type:
            "room_unavailable",

          roomId:
            out.room._id,

          affectedCount:
            out.affectedCount,

          movedCount:
            out.rescheduledCount,

          unscheduledCount:
            out.unscheduledAfter,

          summary:
            out.message,

          details: [
            out.message
          ]
        });

      res.json({
        ...out,

        disruption:
          record
      });
    } catch (e) {
      console.error(
        "ROOM STATUS FAILED:",
        e.stack || e
      );

      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   DISRUPTIONS
========================================================= */

router.get(
  "/disruptions",
  async (_, res) => {
    try {
      res.json(
        await Disruption.find()
          .sort({
            createdAt: -1
          })
          .limit(30)
          .lean()
      );
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   INTERVIEWS
========================================================= */

router.get(
  "/interviews",
  async (req, res) => {
    try {
      const rows =
        await getSchedule();

      const day =
        req.query.day
          ? Number(
            req.query.day
          )
          : null;

      const q =
        (req.query.q || "")
          .toLowerCase()
          .trim();

      let result =
        day
          ? rows.filter(
            x =>
              x.day === day
          )
          : rows;

      if (q) {
        result =
          result.filter(
            x =>
              `
              ${x.studentId?.studentCode}
              ${x.studentId?.name}
              ${x.companyId?.name}
              ${x.studentId?.branch}
              ${x.roomId?.name}
              panel ${x.panel}
              `
                .toLowerCase()
                .includes(q)
          );
      }

      res.json(
        result.slice(
          0,
          Number(
            req.query.limit ||
            10000
          )
        )
      );
    } catch (e) {
      res.status(500).json({
        message: e.message
      });
    }
  }
);

/* =========================================================
   REPLAN HELPER
========================================================= */

/*
  This function is critical.

  For company delay / panel drop:

  We DO NOT want:

      affected 77
      rescheduled 21
      cannot 56

  to become:

      scheduled stays 2108

  because the normal scheduler fills the 56 released
  positions with unrelated candidates.

  We want:

      2108 - 56 = 2052

  and:

      567 + 56 = 623
*/

async function enforceDisruptionCount(
  beforeRows,
  beforeScheduledCount,
  affected,
  companyId = null,
  panel = null
) {
  const afterRows =
    await getSchedule();

  /*
    Find affected interviews that
    actually received a new scheduled
    appointment.
  */

  const affectedStillScheduled =
    affected.filter(
      a =>
        afterRows.some(
          x =>
            String(
              x.studentId?._id ||
              x.studentId
            ) ===
            String(
              a.studentId?._id ||
              a.studentId
            ) &&
            String(
              x.companyId?._id ||
              x.companyId
            ) ===
            String(
              a.companyId?._id ||
              a.companyId
            )
        )
    );

  const successful =
    affectedStillScheduled.length;

  const cannot =
    Math.max(
      0,
      affected.length -
      successful
    );

  const expectedScheduled =
    Math.max(
      0,
      beforeScheduledCount -
      cannot
    );

  /*
    Current scheduler may have filled
    extra candidates.

    Remove ONLY newly-created
    replacement schedules until the
    expected count is reached.

    Existing appointments from before
    the disruption are protected.
  */

  if (
    afterRows.length >
    expectedScheduled
  ) {
    const beforeKeys =
      new Set(
        beforeRows.map(
          x =>
            `${x.studentId?._id || x.studentId}|${x.companyId?._id || x.companyId}|${x.day}|${x.startMinute}|${x.roomId?._id || x.roomId}|${x.panel}`
        )
      );

    const newRows =
      afterRows.filter(
        x =>
          !beforeKeys.has(
            `${x.studentId?._id || x.studentId}|${x.companyId?._id || x.companyId}|${x.day}|${x.startMinute}|${x.roomId?._id || x.roomId}|${x.panel}`
          )
      );

    let excess =
      afterRows.length -
      expectedScheduled;

    /*
      Prefer removing newly created
      appointments that are NOT one
      of the affected students.

      This prevents the scheduler from
      hiding the disruption count.
    */

    const removable =
      newRows
        .filter(
          x =>
            !affected.some(
              a =>
                String(
                  a.studentId?._id ||
                  a.studentId
                ) ===
                String(
                  x.studentId?._id ||
                  x.studentId
                ) &&
                String(
                  a.companyId?._id ||
                  a.companyId
                ) ===
                String(
                  x.companyId?._id ||
                  x.companyId
                )
            )
        );

    const toCancel =
      removable.slice(
        0,
        excess
      );

    if (toCancel.length) {
      await Interview.updateMany(
        {
          _id: {
            $in:
              toCancel.map(
                x => x._id
              )
          }
        },
        {
          $set: {
            status:
              "cancelled",

            cancellationReason:
              "Capacity preserved after disruption; interview remains unscheduled."
          }
        }
      );

      excess -=
        toCancel.length;
    }

    /*
      Safety fallback:
      if some excess remains,
      remove additional newly-created
      rows only.
    */

    if (excess > 0) {
      const remaining =
        newRows
          .filter(
            x =>
              !toCancel.some(
                y =>
                  String(
                    y._id
                  ) ===
                  String(
                    x._id
                  )
              )
          )
          .slice(
            0,
            excess
          );

      if (remaining.length) {
        await Interview.updateMany(
          {
            _id: {
              $in:
                remaining.map(
                  x =>
                    x._id
                )
            }
          },
          {
            $set: {
              status:
                "cancelled",

              cancellationReason:
                "Capacity preserved after disruption; interview remains unscheduled."
            }
          }
        );
      }
    }
  }

  const finalRows =
    await getSchedule();

  return {
    successful:
      Math.min(
        successful,
        affected.length
      ),

    cannot,

    expectedScheduled,

    actualScheduled:
      finalRows.length,

    actualUnscheduled:
      Math.max(
        0,
        (
          await activeShortlistCount()
        ) -
        finalRows.length
      )
  };
}

/* =========================================================
   MAIN REPLAN API
========================================================= */

router.post(
  "/replan",
  async (req, res) => {
    try {
      const {
        type,
        id,
        hours = 2,
        panel = 1
      } = req.body;

      if (!type || !id) {
        return res
          .status(400)
          .json({
            message:
              "Select a disruption target first."
          });
      }

      const before =
        await getSchedule();

      const beforeStats =
        await scheduleStats();

      let affected = [];

      let details = [];

      let company = null;

      let student = null;

      let room = null;

      let placedCompany = null;

      /* =====================================================
         COMPANY DELAY
      ===================================================== */

      if (
        type ===
        "company_delay"
      ) {
        company =
          await Company.findById(
            id
          );

        if (!company) {
          return res
            .status(404)
            .json({
              message:
                "Company not found."
            });
        }

        affected =
          await Interview.find({
            companyId: id,
            status: "scheduled"
          })
            .populate(
              "studentId",
              "studentCode name"
            )
            .populate(
              "roomId",
              "name"
            )
            .lean();

        const delay =
          Math.max(
            0.5,
            Number(hours)
          );

        const oldStart =
          company.startMinute;

        company.startMinute +=
          Math.round(
            delay * 60
          );

        if (
          company.startMinute >=
          company.endMinute
        ) {
          return res
            .status(400)
            .json({
              message:
                `${company.name} delay would move the start window beyond its end time.`
            });
        }

        await company.save();

        details.push(
          `${company.name} delayed by ${delay} hour(s): start window moved from ${minutes(
            oldStart
          )} to ${minutes(
            company.startMinute
          )}.`
        );

        details.push(
          `${affected.length} ${company.name} appointment(s) were affected.`
        );

        /*
          Release only this company's
          appointments.
        */

        if (affected.length) {
          await Interview.updateMany(
            {
              companyId: id,

              status:
                "scheduled"
            },
            {
              $set: {
                status:
                  "cancelled",

                cancellationReason:
                  `${company.name} delayed; released for replanning.`
              }
            }
          );
        }

        /*
          Rebuild only valid schedule.
        */

        await buildSchedule();

        /*
          CRITICAL:
          force final count according to
          successful vs cannot-reschedule.
        */

        const countResult =
          await enforceDisruptionCount(
            before,
            beforeStats.scheduled,
            affected,
            company._id
          );

        const after =
          await getSchedule();

        const afterStats =
          await scheduleStats();

        const beforeMap =
          new Map(
            before.map(
              x => [
                `${x.studentId?._id}-${x.companyId?._id}`,
                x
              ]
            )
          );

        const moved = [];

        for (
          const x of after
        ) {
          const key =
            `${x.studentId?._id}-${x.companyId?._id}`;

          const b =
            beforeMap.get(
              key
            );

          if (!b) {
            continue;
          }

          if (
            b.day !== x.day ||
            b.startMinute !==
            x.startMinute ||
            String(
              b.roomId?._id
            ) !==
            String(
              x.roomId?._id
            ) ||
            b.panel !==
            x.panel
          ) {
            moved.push({
              studentCode:
                x.studentId
                  ?.studentCode,

              student:
                x.studentId
                  ?.name,

              company:
                x.companyId
                  ?.name,

              from: {
                day:
                  b.day,

                startMinute:
                  b.startMinute,

                endMinute:
                  b.endMinute,

                room:
                  b.roomId
                    ?.name,

                panel:
                  b.panel
              },

              to: {
                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId
                    ?.name,

                panel:
                  x.panel
              },

              message:
                `${x.studentId?.studentCode} ${x.studentId?.name} → ${x.companyId?.name}: ${minutes(
                  b.startMinute
                )} ${b.roomId?.name} Panel ${b.panel
                } → ${minutes(
                  x.startMinute
                )} ${x.roomId?.name
                } Panel ${x.panel
                }. Interview rescheduled successfully.`
            });
          }
        }

        const resultMessage =
          `${company.name} delayed by ${delay} hour(s). ${affected.length} students/interviews affected. ${countResult.successful} successfully rescheduled. ${countResult.cannot} could not be rescheduled. Scheduled: ${beforeStats.scheduled} → ${afterStats.scheduled}. Unscheduled: ${beforeStats.unscheduled} → ${afterStats.unscheduled}.`;

        details.push(
          `${countResult.successful} affected interview(s) were successfully rescheduled.`
        );

        details.push(
          `${countResult.cannot} affected interview(s) could not be rescheduled and remain unscheduled.`
        );

        const record =
          await Disruption.create({
            type,

            companyId:
              company._id,

            hours:
              Number(hours),

            affectedCount:
              affected.length,

            movedCount:
              countResult.successful,

            unscheduledCount:
              afterStats.unscheduled,

            summary:
              resultMessage,

            details
          });

        return res.json({
          message:
            resultMessage,

          affectedCount:
            affected.length,

          movedCount:
            countResult.successful,

          rescheduledCount:
            countResult.successful,

          cannotRescheduleCount:
            countResult.cannot,

          scheduledBefore:
            beforeStats.scheduled,

          scheduledAfter:
            afterStats.scheduled,

          unscheduledBefore:
            beforeStats.unscheduled,

          unscheduledAfter:
            afterStats.unscheduled,

          unscheduledCount:
            afterStats.unscheduled,

          moved:
            moved.slice(
              0,
              300
            ),

          details,

          disruption:
            record
        });
      }

      /* =====================================================
         PANEL DROP
      ===================================================== */

      if (
        type ===
        "panel_drop"
      ) {
        company =
          await Company.findById(
            id
          );

        if (!company) {
          return res
            .status(404)
            .json({
              message:
                "Company not found."
            });
        }

        const p =
          Number(panel);

        if (
          p < 1 ||
          p >
          company.panels
        ) {
          return res
            .status(400)
            .json({
              message:
                `Panel ${p} does not exist for ${company.name}.`
            });
        }

        const info =
          (
            company.panelDetails ||
            []
          ).find(
            x =>
              Number(x.number) ===
              p
          );

        if (
          (
            company.blockedPanels ||
            []
          ).includes(p)
        ) {
          return res
            .status(400)
            .json({
              message:
                `Panel ${p} is already unavailable for ${company.name}.`
            });
        }

        const activePanels =
          Number(
            company.panels || 0
          ) -
          (
            company.blockedPanels ||
            []
          ).length -
          1;

        if (
          activePanels < 1
        ) {
          return res
            .status(400)
            .json({
              message:
                `${company.name} would have no active panel left.`
            });
        }

        affected =
          await Interview.find({
            companyId: id,

            panel: p,

            status:
              "scheduled"
          })
            .populate(
              "studentId",
              "studentCode name"
            )
            .populate(
              "roomId",
              "name"
            )
            .lean();

        company.blockedPanels =
          [
            ...(company.blockedPanels ||
              []),

            p
          ];

        await company.save();

        if (affected.length) {
          await Interview.updateMany(
            {
              companyId: id,

              panel: p,

              status:
                "scheduled"
            },
            {
              $set: {
                status:
                  "cancelled",

                cancellationReason:
                  `Panel ${p} dropped out.`
              }
            }
          );
        }

        details.push(
          `${company.name} Panel ${p} dropped out. Assigned interviewers: ${info?.interviewers?.join(
            " + "
          ) ||
          "Not recorded"
          }.`
        );

        details.push(
          `${affected.length} interview(s) were released from Panel ${p}.`
        );

        /*
          IMPORTANT:

          Normal build can create replacement
          interviews.

          enforceDisruptionCount() makes sure
          only the successfully rescheduled
          affected interviews are counted as
          recovered.
        */

        await buildSchedule();

        const countResult =
          await enforceDisruptionCount(
            before,
            beforeStats.scheduled,
            affected,
            company._id,
            p
          );

        const after =
          await getSchedule();

        const afterStats =
          await scheduleStats();

        const beforeMap =
          new Map(
            before.map(
              x => [
                `${x.studentId?._id}-${x.companyId?._id}`,
                x
              ]
            )
          );

        const moved = [];

        for (
          const x of after
        ) {
          const key =
            `${x.studentId?._id}-${x.companyId?._id}`;

          const b =
            beforeMap.get(
              key
            );

          if (!b) {
            continue;
          }

          if (
            b.day !== x.day ||
            b.startMinute !==
            x.startMinute ||
            String(
              b.roomId?._id
            ) !==
            String(
              x.roomId?._id
            ) ||
            b.panel !==
            x.panel
          ) {
            moved.push({
              studentCode:
                x.studentId
                  ?.studentCode,

              student:
                x.studentId
                  ?.name,

              company:
                x.companyId
                  ?.name,

              from: {
                day:
                  b.day,

                startMinute:
                  b.startMinute,

                endMinute:
                  b.endMinute,

                room:
                  b.roomId
                    ?.name,

                panel:
                  b.panel
              },

              to: {
                day:
                  x.day,

                startMinute:
                  x.startMinute,

                endMinute:
                  x.endMinute,

                room:
                  x.roomId
                    ?.name,

                panel:
                  x.panel
              },

              message:
                `${x.studentId?.studentCode} ${x.studentId?.name} → ${x.companyId?.name}: ${minutes(
                  b.startMinute
                )} ${b.roomId?.name} Panel ${b.panel
                } → ${minutes(
                  x.startMinute
                )} ${x.roomId?.name
                } Panel ${x.panel
                }. Interview rescheduled successfully.`
            });
          }
        }

        const resultMessage =
          `${company.name} Panel ${p} dropped out. Assigned interviewers: ${info?.interviewers?.join(
            " + "
          ) ||
          "Not recorded"
          }. ${affected.length} students/interviews affected. ${countResult.successful} students successfully rescheduled. ${countResult.cannot} students could not be rescheduled.`;

        details.push(
          `${countResult.successful} affected interview(s) were successfully rescheduled.`
        );

        details.push(
          `${countResult.cannot} affected interview(s) could not be rescheduled and remain unscheduled.`
        );

        const record =
          await Disruption.create({
            type,

            companyId:
              company._id,

            panel:
              p,

            affectedCount:
              affected.length,

            movedCount:
              countResult.successful,

            unscheduledCount:
              afterStats.unscheduled,

            summary:
              resultMessage,

            details
          });

        return res.json({
          message:
            resultMessage,

          affectedCount:
            affected.length,

          movedCount:
            countResult.successful,

          rescheduledCount:
            countResult.successful,

          cannotRescheduleCount:
            countResult.cannot,

          scheduledBefore:
            beforeStats.scheduled,

          scheduledAfter:
            afterStats.scheduled,

          unscheduledBefore:
            beforeStats.unscheduled,

          unscheduledAfter:
            afterStats.unscheduled,

          unscheduledCount:
            afterStats.unscheduled,

          moved:
            moved.slice(
              0,
              300
            ),

          details,

          disruption:
            record
        });
      }

      /* =====================================================
         STUDENT WITHDRAWAL
      ===================================================== */

      // if (
      //   type ===
      //   "student_withdrawal"
      // ) {
      //   student =
      //     await Student.findById(
      //       id
      //     );

      //   if (!student) {
      //     return res
      //       .status(404)
      //       .json({
      //         message:
      //           "Student not found."
      //       });
      //   }

      //   const withdrawalMode =
      //     req.body
      //       .withdrawalMode ||
      //     "withdrawn";

      //   const offeredCompanyId =
      //     req.body.companyId;

      //   /*
      //     WITHDRAWN + PLACED
      //   */

      //   if (
      //     withdrawalMode ===
      //     "withdrawn_placed"
      //   ) {
      //     if (
      //       !offeredCompanyId
      //     ) {
      //       return res
      //         .status(400)
      //         .json({
      //           message:
      //             "Select the company in which the student received the offer."
      //         });
      //     }

      //     const shortlisted =
      //       await Shortlist.exists({
      //         studentId: id,

      //         companyId:
      //           offeredCompanyId
      //       });

      //     if (!shortlisted) {
      //       return res
      //         .status(400)
      //         .json({
      //           message:
      //             "The selected company must be one of the student's shortlisted companies."
      //         });
      //     }

      //     const scheduledOffer =
      //       await Interview.exists({
      //         studentId: id,

      //         companyId:
      //           offeredCompanyId,

      //         status:
      //           "scheduled"
      //       });

      //     if (!scheduledOffer) {
      //       return res
      //         .status(400)
      //         .json({
      //           message:
      //             "That shortlisted company has no scheduled interview for this student."
      //         });
      //     }

      //     placedCompany =
      //       await Company.findById(
      //         offeredCompanyId
      //       ).select(
      //         "name"
      //       );

      //     if (
      //       !placedCompany
      //     ) {
      //       return res
      //         .status(404)
      //         .json({
      //           message:
      //             "Selected company not found."
      //         });
      //     }
      //   }

      //   const attendedOrOfferedCompanyId =
      //     offeredCompanyId ||
      //     null;

      //   /*
      //     Determine all remaining
      //     scheduled interviews.
      //   */

      //   const withdrawalQuery = {
      //     studentId: id,

      //     status:
      //       "scheduled",

      //     ...(attendedOrOfferedCompanyId
      //       ? {
      //           companyId: {
      //             $ne:
      //               attendedOrOfferedCompanyId
      //           }
      //         }
      //       : {})
      //   };

      //   affected =
      //     await Interview.find(
      //       withdrawalQuery
      //     )
      //       .populate(
      //         "companyId",
      //         "name"
      //       )
      //       .populate(
      //         "roomId",
      //         "name"
      //       )
      //       .lean();

      //   const withdrawalShortlists =
      //     await Shortlist.find({
      //       studentId: id
      //     })
      //       .populate(
      //         "companyId",
      //         "name"
      //       )
      //       .lean();

      //   const withdrawalNames =
      //     withdrawalShortlists
      //       .map(
      //         x =>
      //           x.companyId?.name
      //       )
      //       .filter(Boolean);

      //   if (
      //     withdrawalNames.length
      //   ) {
      //     student.shortlistedCompanySnapshot =
      //       [
      //         ...new Set([
      //           ...(student.shortlistedCompanySnapshot ||
      //             []),

      //           ...withdrawalNames
      //         ])
      //       ];
      //   }

      //   student.status =
      //     withdrawalMode ===
      //     "withdrawn_placed"
      //       ? "Withdrawn + Placed"
      //       : "Withdrawn";

      //   student.placedCompanyId =
      //     placedCompany?._id ||
      //     null;

      //   await student.save();

      //   const reason =
      //     withdrawalMode ===
      //     "withdrawn_placed"
      //       ? "Student received an offer and withdrew from remaining interviews."
      //       : "Student withdrew from placement.";

      //   if (affected.length) {
      //     await Interview.updateMany(
      //       withdrawalQuery,
      //       {
      //         $set: {
      //           status:
      //             "withdrawn",

      //           cancellationReason:
      //             reason
      //         }
      //       }
      //     );
      //   }

      //   await Shortlist.deleteMany({
      //     studentId: id
      //   });

      //   const withdrawalReleasedSlots =
      //     affected.map(
      //       x => ({
      //         studentId:
      //           x.studentId,

      //         companyId:
      //           x.companyId,

      //         roomId:
      //           x.roomId,

      //         day:
      //           x.day,

      //         panel:
      //           x.panel,

      //         startMinute:
      //           x.startMinute,

      //         endMinute:
      //           x.endMinute
      //       })
      //     );

      //   await buildSchedule({
      //     releasedSlots:
      //       withdrawalReleasedSlots,

      //     minimumTargetCount:
      //       beforeStats.scheduled
      //   });

      //   const after =
      //     await getSchedule();

      //   const afterStats =
      //     await scheduleStats();

      //   const beforePairs =
      //     new Set(
      //       before.map(
      //         x =>
      //           `${x.studentId?._id}-${x.companyId?._id}`
      //       )
      //     );

      //   const moved = [];

      //   for (
      //     const x of after
      //   ) {
      //     const key =
      //       `${x.studentId?._id}-${x.companyId?._id}`;

      //     const b =
      //       beforePairs.has(
      //         key
      //       )
      //         ? before.find(
      //             y =>
      //               `${y.studentId?._id}-${y.companyId?._id}` ===
      //               key
      //           )
      //         : null;

      //     if (
      //       !b
      //     ) {
      //       continue;
      //     }

      //     if (
      //       b.day !== x.day ||
      //       b.startMinute !==
      //         x.startMinute ||
      //       String(
      //         b.roomId?._id
      //       ) !==
      //         String(
      //           x.roomId?._id
      //         ) ||
      //       b.panel !==
      //         x.panel
      //     ) {
      //       moved.push({
      //         studentCode:
      //           x.studentId
      //             ?.studentCode,

      //         student:
      //           x.studentId
      //             ?.name,

      //         company:
      //           x.companyId
      //             ?.name,

      //         from: {
      //           day:
      //             b.day,

      //           startMinute:
      //             b.startMinute,

      //           endMinute:
      //             b.endMinute,

      //           room:
      //             b.roomId
      //               ?.name,

      //           panel:
      //             b.panel
      //         },

      //         to: {
      //           day:
      //             x.day,

      //           startMinute:
      //             x.startMinute,

      //           endMinute:
      //             x.endMinute,

      //           room:
      //             x.roomId
      //               ?.name,

      //           panel:
      //             x.panel
      //         }
      //       });
      //     }
      //   }

      //   const resultMessage =
      //     withdrawalMode ===
      //     "withdrawn_placed"
      //       ? `${student.studentCode} | ${student.name} changed to Withdrawn + Placed with ${placedCompany.name}. ${affected.length} remaining interview(s) were withdrawn. Released capacity was reconsidered.`
      //       : `${student.studentCode} | ${student.name} changed to Withdrawn. ${affected.length} scheduled interview(s) were withdrawn. Released capacity was reconsidered.`;

      //   const record =
      //     await Disruption.create({
      //       type,

      //       studentId:
      //         student._id,

      //       affectedCount:
      //         affected.length,

      //       movedCount:
      //         moved.length,

      //       unscheduledCount:
      //         afterStats.unscheduled,

      //       summary:
      //         resultMessage,

      //       details: [
      //         resultMessage
      //       ]
      //     });

      //   return res.json({
      //     message:
      //       resultMessage,

      //     affectedCount:
      //       affected.length,

      //     movedCount:
      //       moved.length,

      //     scheduledBefore:
      //       beforeStats.scheduled,

      //     scheduledAfter:
      //       afterStats.scheduled,

      //     unscheduledBefore:
      //       beforeStats.unscheduled,

      //     unscheduledAfter:
      //       afterStats.unscheduled,

      //     unscheduledCount:
      //       afterStats.unscheduled,

      //     moved:
      //       moved.slice(
      //         0,
      //         300
      //       ),

      //     details: [
      //       resultMessage
      //     ],

      //     disruption:
      //       record,

      //     status:
      //       student.status,

      //     placedCompany:
      //       placedCompany?.name ||
      //       undefined
      //   });
      // }
     if (type === "student_withdrawal") {
  student = await Student.findById(id);

  if (!student) {
    return res.status(404).json({
      message: "Student not found."
    });
  }

  const withdrawalMode =
    req.body.withdrawalMode || "withdrawn";

  const offeredCompanyId =
    req.body.companyId;

  /*
   * =========================================================
   * WITHDRAWN + PLACED
   * =========================================================
   */

  if (withdrawalMode === "withdrawn_placed") {
    if (!offeredCompanyId) {
      return res.status(400).json({
        message:
          "Select the company in which the student received the offer."
      });
    }

    const shortlisted = await Shortlist.exists({
      studentId: id,
      companyId: offeredCompanyId
    });

    if (!shortlisted) {
      return res.status(400).json({
        message:
          "The selected company must be one of the student's shortlisted companies."
      });
    }

    const scheduledOffer = await Interview.exists({
      studentId: id,
      companyId: offeredCompanyId,
      status: "scheduled"
    });

    if (!scheduledOffer) {
      return res.status(400).json({
        message:
          "That shortlisted company has no scheduled interview for this student."
      });
    }

    placedCompany = await Company.findById(
      offeredCompanyId
    ).select("name");

    if (!placedCompany) {
      return res.status(404).json({
        message: "Selected company not found."
      });
    }
  }

  /*
   * =========================================================
   * SAVE CURRENT SCHEDULE BEFORE WITHDRAWAL
   * =========================================================
   *
   * This is important because we need to compare the schedule
   * before and after the replacement process.
   */

  const before = await getSchedule();

  const beforeStats = await scheduleStats();

  /*
   * =========================================================
   * FIND ALL SCHEDULED INTERVIEWS THAT MUST BE RELEASED
   * =========================================================
   *
   * If the student is placed with Company A:
   *
   *   A = kept
   *   B = cancelled
   *   C = cancelled
   *   D = cancelled
   *
   * If normal withdrawal:
   *
   *   A = cancelled
   *   B = cancelled
   *   C = cancelled
   */

  const keptCompanyId =
    offeredCompanyId || null;

  const withdrawalQuery = {
    studentId: id,
    status: "scheduled",

    ...(keptCompanyId
      ? {
          companyId: {
            $ne: keptCompanyId
          }
        }
      : {})
  };

  affected = await Interview.find(
    withdrawalQuery
  )
    .populate("companyId", "name")
    .populate("roomId", "name")
    .lean();

  /*
   * =========================================================
   * SAVE SHORTLIST COMPANY NAMES
   * =========================================================
   */

  const withdrawalShortlists =
    await Shortlist.find({
      studentId: id
    })
      .populate("companyId", "name")
      .lean();

  const withdrawalNames =
    withdrawalShortlists
      .map(x => x.companyId?.name)
      .filter(Boolean);

  if (withdrawalNames.length) {
    student.shortlistedCompanySnapshot = [
      ...new Set([
        ...(student.shortlistedCompanySnapshot || []),
        ...withdrawalNames
      ])
    ];
  }

  /*
   * =========================================================
   * UPDATE STUDENT STATUS
   * =========================================================
   */

  student.status =
    withdrawalMode === "withdrawn_placed"
      ? "Withdrawn + Placed"
      : "Withdrawn";

  student.placedCompanyId =
    placedCompany?._id || null;

  await student.save();

  /*
   * =========================================================
   * CANCEL REMAINING INTERVIEWS
   * =========================================================
   */

  const reason =
    withdrawalMode === "withdrawn_placed"
      ? "Student received an offer and withdrew from remaining interviews."
      : "Student withdrew from placement.";

  if (affected.length) {
    await Interview.updateMany(
      withdrawalQuery,
      {
        $set: {
          status: "withdrawn",
          cancellationReason: reason
        }
      }
    );
  }

  /*
   * =========================================================
   * RELEASE THE EXACT INTERVIEW SLOTS
   * =========================================================
   *
   * Example:
   *
   * Student E:
   *
   * A -> scheduled
   * B -> scheduled
   * C -> unscheduled
   * D -> scheduled
   *
   * If E withdraws after receiving A:
   *
   * B slot -> released
   * D slot -> released
   *
   * Those exact slots are sent to scheduler.js.
   */

  const withdrawalReleasedSlots =
    affected.map(x => ({
      studentId: x.studentId,
      companyId: x.companyId,
      roomId: x.roomId,
      day: x.day,
      panel: x.panel,
      startMinute: x.startMinute,
      endMinute: x.endMinute
    }));

  /*
   * =========================================================
   * REMOVE STUDENT FROM ACTIVE SHORTLIST
   * =========================================================
   */

  await Shortlist.deleteMany({
    studentId: id
  });

  /*
   * =========================================================
   * REBUILD USING RELEASED CAPACITY
   * =========================================================
   *
   * scheduler.js receives the released slots and tries to
   * give those exact appointments to other eligible students
   * who are shortlisted for the same company.
   */

  await buildSchedule({
    releasedSlots: withdrawalReleasedSlots,

    /*
     * Do not allow the withdrawal itself to reduce the normal
     * scheduling target when replacement students are available.
     */
    minimumTargetCount: beforeStats.scheduled
  });

  /*
   * =========================================================
   * GET FINAL SCHEDULE
   * =========================================================
   */

  const after = await getSchedule();

  const afterStats = await scheduleStats();

  /*
   * =========================================================
   * FIND MOVED / REPLACEMENT INTERVIEWS
   * =========================================================
   */

  const beforeMap = new Map();

  for (const x of before) {
    const key =
      `${x.studentId?._id}-${x.companyId?._id}`;

    beforeMap.set(key, x);
  }

  /*
   * Released appointment keys.
   *
   * These are the old student's appointments that became free.
   */

  const releasedKeys = new Set(
    affected.map(x =>
      `${x.studentId?._id}-${x.companyId?._id}`
    )
  );

  /*
   * Find newly created appointments.
   *
   * A replacement is an interview that:
   *
   * 1. belongs to another student
   * 2. uses the same company
   * 3. occupies one of the released slots
   */

  const replacements = [];

  for (const x of after) {
    const isNew =
      !beforeMap.has(
        `${x.studentId?._id}-${x.companyId?._id}`
      );

    if (!isNew) continue;

    const replacement = affected.find(old =>
      String(old.companyId?._id) ===
        String(x.companyId?._id) &&
      Number(old.day) === Number(x.day) &&
      Number(old.startMinute) ===
        Number(x.startMinute) &&
      Number(old.endMinute) ===
        Number(x.endMinute) &&
      String(old.roomId?._id) ===
        String(x.roomId?._id) &&
      Number(old.panel) === Number(x.panel)
    );

    if (!replacement) continue;

    replacements.push({
      studentCode:
        x.studentId?.studentCode,

      student:
        x.studentId?.name,

      company:
        x.companyId?.name,

      day:
        x.day,

      startMinute:
        x.startMinute,

      endMinute:
        x.endMinute,

      room:
        x.roomId?.name,

      panel:
        x.panel,

      replacedStudentCode:
        replacement.studentId?.studentCode,

      replacedStudent:
        replacement.studentId?.name
    });
  }

  /*
   * =========================================================
   * FIND OTHER MOVED INTERVIEWS
   * =========================================================
   */

  const moved = [];

  for (const x of after) {
    const key =
      `${x.studentId?._id}-${x.companyId?._id}`;

    const b = beforeMap.get(key);

    if (!b) continue;

    if (
      Number(b.day) !== Number(x.day) ||
      Number(b.startMinute) !==
        Number(x.startMinute) ||
      Number(b.endMinute) !==
        Number(x.endMinute) ||
      String(b.roomId?._id) !==
        String(x.roomId?._id) ||
      Number(b.panel) !== Number(x.panel)
    ) {
      moved.push({
        studentCode:
          x.studentId?.studentCode,

        student:
          x.studentId?.name,

        company:
          x.companyId?.name,

        from: {
          day: b.day,
          startMinute: b.startMinute,
          endMinute: b.endMinute,
          room: b.roomId?.name,
          panel: b.panel
        },

        to: {
          day: x.day,
          startMinute: x.startMinute,
          endMinute: x.endMinute,
          room: x.roomId?.name,
          panel: x.panel
        }
      });
    }
  }

  /*
   * =========================================================
   * MESSAGE
   * =========================================================
   */

  const resultMessage =
    withdrawalMode === "withdrawn_placed"
      ? `${student.studentCode} | ${student.name} changed to Withdrawn + Placed with ${placedCompany.name}. ${affected.length} remaining interview(s) were withdrawn. Released interview capacity was reassigned where possible.`
      : `${student.studentCode} | ${student.name} changed to Withdrawn. ${affected.length} scheduled interview(s) were withdrawn. Released interview capacity was reassigned where possible.`;

  /*
   * =========================================================
   * DISRUPTION RECORD
   * =========================================================
   */

  const record = await Disruption.create({
    type,

    studentId:
      student._id,

    affectedCount:
      affected.length,

    movedCount:
      moved.length,

    unscheduledCount:
      afterStats.unscheduled,

    summary:
      resultMessage,

    details: [
      resultMessage
    ]
  });

  /*
   * =========================================================
   * FINAL RESPONSE
   * =========================================================
   */

  // return res.json({
  //   message:
  //     resultMessage,

  //   affectedCount:
  //     affected.length,

  //   movedCount:
  //     moved.length,

  //   replacementCount:
  //     replacements.length,

  //   scheduledBefore:
  //     beforeStats.scheduled,

  //   scheduledAfter:
  //     afterStats.scheduled,

  //   unscheduledBefore:
  //     beforeStats.unscheduled,

  //   unscheduledAfter:
  //     afterStats.unscheduled,

  //   unscheduledCount:
  //     afterStats.unscheduled,

  //   moved:
  //     moved.slice(0, 300),

  //   replacements:
  //     replacements.slice(0, 300),

  //   details: [
  //     resultMessage
  //   ],

  //   disruption:
  //     record,

  //   status:
  //     student.status,

  //   placedCompany:
  //     placedCompany?.name ||
  //     undefined
  // });

return res.json({
  message: resultMessage,

  affectedCount: affected.length,

  // Existing frontend compatibility
  cancelledCount: affected.length,

  cancelledInterviews: affected.map(x => ({
    studentCode: student.studentCode,
    student: student.name,
    company: x.companyId?.name,
    day: x.day,
    startMinute: x.startMinute,
    endMinute: x.endMinute,
    room: x.roomId?.name,
    panel: x.panel
  })),

  movedCount: moved.length,

  moved: moved.slice(0, 300),

  // Replacement information
  replacementCount: replacements.length,

  replacements: replacements.slice(0, 300),

  // Frontend-friendly name
  replacementStudents: replacements.slice(0, 300),

  scheduledBefore: beforeStats.scheduled,

  scheduledAfter: afterStats.scheduled,

  unscheduledBefore: beforeStats.unscheduled,

  unscheduledAfter: afterStats.unscheduled,

  unscheduledCount: afterStats.unscheduled,

  details: [
    resultMessage
  ],

  disruption: record,

  status: student.status,

  placedCompany:
    placedCompany?.name || undefined
});
}
      /* =====================================================
         ROOM UNAVAILABLE
      ===================================================== */

      if (
        type ===
        "room_unavailable"
      ) {
        const out =
          await roomAction(
            id,
            "unavailable"
          );

        room =
          out.room;

        const record =
          await Disruption.create({
            type,

            roomId:
              room._id,

            affectedCount:
              out.affectedCount,

            movedCount:
              out.rescheduledCount,

            unscheduledCount:
              out.unscheduledAfter,

            summary:
              out.message,

            details: [
              out.message
            ]
          });

        return res.json({
          ...out,

          moved: [],

          details: [
            out.message
          ],

          disruption:
            record,

          message:
            out.message,

          unscheduledCount:
            out.unscheduledAfter
        });
      }

      return res
        .status(400)
        .json({
          message:
            "Unknown disruption type."
        });
    } catch (e) {
      console.error(
        "REPLAN FAILED:",
        e.stack || e
      );

      res.status(500).json({
        message: e.message
      });
    }
  }
);

export default router;