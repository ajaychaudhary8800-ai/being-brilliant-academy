# Database ER diagram

The complete Prisma schema is the authoritative field-level reference. This diagram captures the principal ownership and operational relationships.

```mermaid
erDiagram
  ORGANIZATION ||--o{ USER : owns
  ORGANIZATION ||--o{ BRANCH : owns
  BRANCH ||--o{ COURSE : offers
  COURSE ||--o{ BATCH : contains
  BATCH ||--o{ STUDENT_PROFILE : enrolls
  USER ||--o| STUDENT_PROFILE : identifies
  USER ||--o| TEACHER_PROFILE : identifies
  STUDENT_PROFILE ||--o{ ATTENDANCE : receives
  STUDENT_PROFILE ||--o{ FEE : owes
  STUDENT_PROFILE ||--o{ CERTIFICATE : receives
  BATCH ||--o{ HOMEWORK : receives
  HOMEWORK ||--o{ HOMEWORK_SUBMISSION : collects
  STUDENT_PROFILE ||--o{ HOMEWORK_SUBMISSION : submits
  BATCH ||--o{ EXAMINATION : schedules
  EXAMINATION ||--o{ EXAMINATION_RESULT : produces
  STUDENT_PROFILE ||--o{ EXAMINATION_RESULT : earns
  COURSE ||--o{ LMS_MODULE : contains
  LMS_MODULE ||--o{ LESSON : contains
  USER ||--o{ LESSON_PROGRESS : tracks
  ORGANIZATION ||--o{ AUDIT_LOG : records
  ORGANIZATION ||--o{ NOTIFICATION : scopes
  ORGANIZATION ||--o{ ACCOUNT : owns
  ORGANIZATION ||--o{ EMPLOYEE : employs
  ORGANIZATION ||--o{ VEHICLE : owns
  ORGANIZATION ||--o{ HOSTEL : owns
  ORGANIZATION ||--o{ LIBRARY_BOOK : owns
  ORGANIZATION ||--o{ ASSET : owns
```

Every tenant-scoped table includes `organizationId`; compound uniqueness and lookup indexes enforce tenant isolation and query locality.

