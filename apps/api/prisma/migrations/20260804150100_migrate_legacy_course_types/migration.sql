UPDATE "Course" SET "type" = 'JEE' WHERE "type"::text NOT IN ('SCHOOL','JEE','NEET','CUET','NDA','CA_FOUNDATION','SKILL','OTHER');
