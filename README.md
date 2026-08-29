# PlacementOS — Placement Week Scheduler

A full-stack placement interview scheduling system designed to help college placement coordinators plan, monitor, and dynamically manage multi-company interview schedules across a four-day placement week.

The system automatically generates interview schedules while considering student availability, company requirements, interview duration, panel availability, room capacity, scheduling buffers, and operational disruptions.

It also provides real-time visibility into scheduled and unscheduled interviews, room utilization, student status, company panels, and schedule changes.

---

## Overview

Managing placement interviews for hundreds of students and multiple recruiting companies can become difficult when students are shortlisted for several companies and interview resources are limited.

**PlacementOS** addresses this problem by providing a centralized scheduling and monitoring system.

The application supports:

* Multi-company interview scheduling
* Student-company shortlisting
* Four-day placement scheduling
* Multiple interview panels
* Room and panel allocation
* Student transition buffers
* Schedule monitoring
* Unscheduled student tracking
* Dynamic disruption handling
* Room availability management
* Student withdrawal and placement status
* Schedule recalculation after operational changes

The included dataset contains:

* **800 students**
* **35 companies**
* **20 interview rooms**
* **4 placement days**

---

## Key Features

### 1. Automated Schedule Generation

The scheduler generates interview appointments based on available resources and scheduling constraints.

It considers:

* Student availability
* Company availability
* Interview duration
* Panel availability
* Room availability
* Room panel/stream limits
* Student transition buffer
* Company priority
* Existing scheduled interviews
* Available scheduling days

The system aims to produce a practical schedule while avoiding student and panel conflicts.

---

### 2. Four-Day Placement Week

The scheduler distributes interviews across a four-day placement period.

Each interview contains information such as:

* Student
* Company
* Day
* Time
* Room
* Panel
* Interview duration
* Interview status

---

### 3. Student Management

The application provides a student directory containing the placement dataset.

Student information can be used to track:

* Student identity
* Eligibility status
* Shortlisted companies
* Scheduled interviews
* Unscheduled interviews
* Placement status
* Withdrawal status

---

### 4. Company Management

The company section provides information about participating recruiters.

Each company can have:

* Company name
* Priority
* Interview duration
* Interview panels
* Interviewers
* Placement days
* Shortlisted students

---

### 5. Room Monitoring

The room monitoring section provides an operational view of interview rooms.

It displays information about:

* Room availability
* Interview panels
* Companies
* Interviewers
* Candidates
* Interview timings

Rooms can be dynamically taken out of service and returned to availability.

---

### 6. Disruption Management

Placement schedules can change during the placement week.

PlacementOS provides a disruption simulator for handling operational changes such as:

#### Company Delay

A company can be delayed, after which the scheduler recalculates the affected appointments.

#### Panel Dropout

A panel can be removed from service and affected interviews can be reassigned where feasible.

#### Student Withdrawal

A student can withdraw from the placement process.

The system updates the student's status and removes or adjusts the student's remaining interview schedules.

If a student has received an offer, the placement company can be recorded and the student can be represented as:

**Withdrawn + Placed**

#### Room Unavailability

A room can be marked unavailable.

The scheduler recalculates the schedule using the remaining available rooms. Affected interviews may be reassigned when capacity permits, while interviews that cannot be accommodated remain unscheduled.

When the room becomes available again, the scheduling system can use the restored capacity to accommodate unscheduled interviews.

---

## Scheduling Constraints

The scheduler incorporates several practical constraints.

### Student Conflict Prevention

A student should not have overlapping interviews.

A **10-minute transition buffer** is also maintained around student interview appointments to provide time for movement between interviews.

### Panel Availability

A company panel cannot conduct overlapping interviews.

### Room Availability

Only rooms currently available to the scheduler can be assigned to new interviews.

### Room Streams

A room can support multiple interview streams during a day, subject to the configured room limits.

### Interview Duration

Interview end times are calculated from the company's configured interview duration.

### Company Priority

Companies can be prioritized during scheduling so that higher-priority recruiting activities receive scheduling consideration first.

### Schedule Target

The scheduling configuration supports a target scheduling range, with the current scheduler configured to operate within approximately **70%–80%** of active shortlisted interview demand during normal generation, subject to actual scheduling feasibility and available capacity.

The final scheduled count may differ from the theoretical target when hard constraints prevent additional interviews from being placed.

---

## Dashboard

The dashboard provides a centralized overview of the placement operation.

It can be used to monitor:

* Total interviews
* Scheduled interviews
* Unscheduled interviews
* Placement scheduling status
* Room availability
* Operational disruptions
* Schedule readiness
* Current scheduling information

---

## Technology Stack

### Frontend

* React
* React DOM
* Vite
* Axios

### Backend

* Node.js
* Express.js
* Mongoose
* MongoDB
* dotenv

### Development Tools

* Visual Studio Code
* Git / GitHub
* npm
* Nodemon

---

## Project Structure

```text
PlacementOS/
│
├── client/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── services/
│   │   │   └── api.js
│   │   └── styles.css
│   │
│   ├── index.html
│   ├── package.json
│   └── package-lock.json
│
├── server/
│   ├── models/
│   │   ├── Company.js
│   │   ├── Disruption.js
│   │   ├── Interview.js
│   │   ├── Room.js
│   │   ├── ScheduleConfig.js
│   │   ├── Shortlist.js
│   │   └── Student.js
│   │
│   ├── routes/
│   │   └── api.js
│   │
│   ├── services/
│   │   └── scheduler.js
│   │
│   ├── utils/
│   │   ├── data/
│   │   │   ├── companies.json
│   │   │   ├── rooms.json
│   │   │   ├── students.json
│   │   │   └── README.md
│   │   └── generator.js
│   │
│   ├── models/
│   ├── server.js
│   ├── package.json
│   └── .env.example
│
└── README.md
```

---

## Prerequisites

Before running the application, install:

* Node.js
* npm
* MongoDB

A local MongoDB installation can be used, or the application can be configured to connect to a MongoDB deployment.

---

## Installation

### 1. Clone the Repository

```bash
git clone <your-github-repository-url>
cd PlacementOS
```

---

### 2. Install Backend Dependencies

```bash
cd server
npm install
```

---

### 3. Configure Environment Variables

Create a `.env` file inside the `server` directory.

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/mirai_placement_scheduler
```

The repository should contain `.env.example` as a reference.

**Do not commit your actual `.env` file or database credentials to GitHub.**

---

### 4. Start the Backend

From the `server` directory:

```bash
npm run dev
```

Or:

```bash
npm start
```

The backend runs on:

```text
http://localhost:5000
```

---

### 5. Install Frontend Dependencies

Open another terminal:

```bash
cd client
npm install
```

---

### 6. Start the Frontend

```bash
npm run dev
```

Vite will provide the local frontend URL in the terminal, normally:

```text
http://localhost:5173
```

Open the displayed URL in your browser.

---

## Dataset

The project includes an editable dataset under:

```text
server/utils/data/
```

The dataset contains:

* `students.json` — 800 student records
* `companies.json` — 35 company records
* `rooms.json` — 20 room records

The dataset can be modified and regenerated through the application's **Generate / Reset** functionality.

---

## How to Use

### Step 1 — Start MongoDB

Ensure MongoDB is running.

### Step 2 — Start the Backend

```bash
cd server
npm run dev
```

### Step 3 — Start the Frontend

```bash
cd client
npm run dev
```

### Step 4 — Open PlacementOS

Open the frontend URL provided by Vite.

### Step 5 — Generate / Reset

Use **Generate / Reset** to initialize the placement dataset and generate the interview schedule.

### Step 6 — Explore the Schedule

Use the navigation to view:

* Overview
* Interview Schedule
* Companies
* Students
* Student Status
* Rooms
* Unscheduled Students
* Disruptions

---

## Disruption Workflow

PlacementOS allows the coordinator to simulate real-world placement disruptions.

### Company Delay

1. Open **Disruptions**
2. Select Company Delay
3. Select the company
4. Specify the delay
5. Apply the disruption
6. Review the updated schedule

### Panel Dropout

1. Open **Disruptions**
2. Select Panel Dropout
3. Select the company
4. Select the affected panel
5. Apply the disruption
6. Review reassigned appointments

### Student Withdrawal

1. Select the student
2. Start the withdrawal process
3. Specify whether the student has received an offer
4. If applicable, select the placement company
5. Confirm withdrawal
6. Review the student's updated status and remaining schedules

### Room Unavailability

1. Open **Disruptions**
2. Select the room
3. Mark the room unavailable
4. Review the affected schedule
5. The scheduler attempts to reassign affected interviews using available capacity

A room can subsequently be returned to service.

---

## Schedule Monitoring

The application provides visibility into individual appointments, including:

```text
Student
Company
Day
Interview Time
Room
Panel
Interviewer
Status
```

This makes it possible for a coordinator to monitor the operational schedule and identify affected appointments after disruptions.

---

## Design Approach

The application follows a separation between the frontend, API layer, database models, and scheduling logic.

```text
React Frontend
      │
      ▼
Axios API Layer
      │
      ▼
Express.js REST API
      │
      ├───────────────┐
      ▼               ▼
MongoDB         Scheduling Engine
                      │
                      ▼
              Updated Interview Schedule
```

The scheduling engine is implemented as a dedicated backend service so that scheduling decisions remain separate from the user interface.

---

## Scheduling Engine

The core scheduling logic is implemented in:

```text
server/services/scheduler.js
```

The scheduler maintains scheduling state for:

* Students
* Panels
* Rooms
* Interview streams
* Daily capacity

It checks conflicts before creating an appointment and selects an available room and panel configuration for the interview.

When a disruption occurs, the schedule can be rebuilt using the current operational state.

---

## Data Models

MongoDB is used to persist the placement scheduling data.

Primary models include:

* **Student** — student information and placement status
* **Company** — recruiter and interview configuration
* **Shortlist** — student-company relationships
* **Interview** — scheduled interview appointments
* **Room** — interview room configuration and availability
* **Disruption** — recorded operational disruptions
* **ScheduleConfig** — scheduling configuration

---

## Error Handling

The application provides user-facing notifications for API and scheduling errors.

The backend also validates the MongoDB connection before starting the server.

If MongoDB is unavailable, the backend reports the connection failure instead of starting with an invalid database connection.

---

## Future Improvements

Potential future improvements include:

* Authentication and role-based access
* Cloud deployment
* Real-time updates using WebSockets
* Calendar export
* Email/SMS notifications
* Advanced optimization algorithms
* Historical schedule analytics
* Coordinator audit logs
* Multi-campus placement support

---

## Project Purpose

This project was developed as a practical solution for managing large-scale college placement interview scheduling.

The primary focus was to combine:

**Scheduling + Resource Management + Conflict Prevention + Disruption Recovery + Operational Monitoring**

into a single web-based placement coordination system.

---

## Author

**Mahammad Saneem**

BCA Graduate | Software & Web Development

---

## Assignment

**Software Developer Intern — Assignment A**

**Project:** Placement Week Scheduler

**Organization:** Mirai Labs

---

## License

This project was developed for assessment and demonstration purposes.