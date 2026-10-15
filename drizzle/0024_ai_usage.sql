CREATE TABLE "ai_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"feature" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_feature_pk" PRIMARY KEY("user_id","day","feature")
);
