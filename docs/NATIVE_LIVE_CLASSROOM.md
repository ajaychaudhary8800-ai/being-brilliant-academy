# Native Live Classroom

## Purpose

The native classroom keeps teachers and learners inside Being Brilliant ERP + LMS while using LiveKit as the underlying WebRTC SFU/media infrastructure. Zoom, Google Meet and Jitsi remain optional fallback providers.

## Production capabilities

- in-portal camera and microphone;
- teacher and permission-controlled student screen sharing;
- adaptive WebRTC media and reconnect support from LiveKit;
- pre-join camera/microphone test;
- connection-quality indicator;
- participant list;
- class chat and raise hand;
- teacher room lock/unlock;
- teacher mute and remove-participant controls;
- collaborative whiteboard;
- teacher-controlled student whiteboard permission;
- screen annotation overlay;
- automatic join/leave attendance;
- S3-compatible MP4 recording through LiveKit Egress;
- protected recording download;
- automatic LMS Study Material publication after recording stop;
- parent observer mode;
- external Zoom/Google Meet/Jitsi/custom HTTPS link fallback.

## Required environment

Native audio/video requires:

```
LIVEKIT_URL=wss://<project-host>
LIVEKIT_API_KEY=<api-key>
LIVEKIT_API_SECRET=<api-secret>
```

For production recording, object storage is also required:

```
STORAGE_DRIVER=s3
AWS_REGION=<region>
AWS_S3_BUCKET=<bucket>
AWS_S3_ENDPOINT=<optional S3-compatible endpoint such as R2>
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret>
LIVEKIT_RECORDING_PREFIX=live-class-recordings
```

Never expose the LiveKit API secret to the browser. Participant tokens are minted by the API and are short-lived.

## Recommended deployment

For the first commercial release, use LiveKit Cloud in a region close to the institution/student population. Self-hosting is supported by the architecture, but requires operating LiveKit plus Egress/TURN capacity and monitoring.

Cloudflare R2 or another S3-compatible bucket can be used for recordings when the configured LiveKit environment can write to that S3-compatible endpoint.

## Classroom permissions

Teacher / authorized manager:
- camera/mic;
- screen share;
- room moderation;
- lock/unlock;
- mute/remove;
- grant/revoke student screen share;
- annotate;
- whiteboard control;
- recording.

Student:
- camera/mic;
- chat;
- raise hand;
- whiteboard when teacher permits;
- screen sharing when teacher grants permission.

Parent:
- observer-only media and classroom visibility;
- no publishing/chat controls.

## Recording lifecycle

1. Teacher starts recording.
2. LiveKit Egress writes the MP4 directly to S3-compatible object storage.
3. Teacher stops recording.
4. The ERP creates/updates a published VIDEO Study Material referencing the same storage object.
5. Students access the recording through the authenticated LMS material-download route.

Large recording bytes are not copied into PostgreSQL.

## Deployment order

1. Configure LiveKit credentials on staging API.
2. Configure S3/R2 credentials if recording is required.
3. Deploy API; Prisma migration applies.
4. Deploy Web.
5. Schedule a Native classroom, publish it and join with two test users.
6. Verify camera/mic, screen sharing, chat, hand raise, whiteboard, annotations and teacher moderation.
7. Record a short class, stop recording, verify it appears under Learning Resources / Materials and downloads after Egress finishes.
8. Repeat on production only after staging smoke test passes.

## Operational notes

- Camera/microphone/screen capture require HTTPS in normal browser production use.
- Native classroom uses opaque room IDs and does not place student names/emails in room names.
- Recording is disabled in the UI unless both LiveKit and S3-compatible storage configuration are present.
- External meeting providers remain available as a fallback if native classroom infrastructure is unavailable.
