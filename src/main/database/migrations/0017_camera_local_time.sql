ALTER TABLE `deployments` ADD `sourceDeploymentStart` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `sourceDeploymentEnd` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `cameraTimeZone` text;--> statement-breakpoint
ALTER TABLE `media` ADD `sourceTimestamp` text;--> statement-breakpoint
ALTER TABLE `media` ADD `localTimestamp` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `sourceEventStart` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `sourceEventEnd` text;
--> statement-breakpoint
-- No UPDATE/backfill: source values lost by previous imports cannot be recovered.
CREATE TRIGGER deployments_camera_insert AFTER INSERT ON deployments BEGIN
  UPDATE deployments SET
    sourceDeploymentStart = COALESCE(NEW.sourceDeploymentStart, NEW.deploymentStart),
    sourceDeploymentEnd = COALESCE(NEW.sourceDeploymentEnd, NEW.deploymentEnd),
    deploymentStart = camera_utc(COALESCE(NEW.sourceDeploymentStart, NEW.deploymentStart), NEW.cameraTimeZone),
    deploymentEnd = camera_utc(COALESCE(NEW.sourceDeploymentEnd, NEW.deploymentEnd), NEW.cameraTimeZone)
  WHERE deploymentID = NEW.deploymentID;
END;
--> statement-breakpoint
CREATE TRIGGER deployments_camera_source AFTER UPDATE OF sourceDeploymentStart, sourceDeploymentEnd, cameraTimeZone ON deployments BEGIN
  UPDATE deployments SET
    deploymentStart = camera_utc(NEW.sourceDeploymentStart, NEW.cameraTimeZone),
    deploymentEnd = camera_utc(NEW.sourceDeploymentEnd, NEW.cameraTimeZone)
  WHERE deploymentID = NEW.deploymentID;
END;
--> statement-breakpoint
CREATE TRIGGER deployments_camera_zone AFTER UPDATE OF cameraTimeZone ON deployments
WHEN NEW.cameraTimeZone IS NOT OLD.cameraTimeZone BEGIN
  UPDATE media SET sourceTimestamp = sourceTimestamp WHERE deploymentID = NEW.deploymentID;
  UPDATE observations SET sourceEventStart = sourceEventStart, sourceEventEnd = sourceEventEnd
    WHERE deploymentID = NEW.deploymentID;
END;
--> statement-breakpoint
CREATE TRIGGER deployments_camera_start AFTER UPDATE OF deploymentStart ON deployments
WHEN NEW.sourceDeploymentStart IS OLD.sourceDeploymentStart
  AND NEW.deploymentStart IS NOT camera_utc(OLD.sourceDeploymentStart, NEW.cameraTimeZone)
BEGIN
  UPDATE deployments SET sourceDeploymentStart = NEW.deploymentStart WHERE deploymentID = NEW.deploymentID;
END;
--> statement-breakpoint
CREATE TRIGGER deployments_camera_end AFTER UPDATE OF deploymentEnd ON deployments
WHEN NEW.sourceDeploymentEnd IS OLD.sourceDeploymentEnd
  AND NEW.deploymentEnd IS NOT camera_utc(OLD.sourceDeploymentEnd, NEW.cameraTimeZone)
BEGIN
  UPDATE deployments SET sourceDeploymentEnd = NEW.deploymentEnd WHERE deploymentID = NEW.deploymentID;
END;
--> statement-breakpoint
CREATE TRIGGER media_camera_insert AFTER INSERT ON media BEGIN
  UPDATE media SET
    sourceTimestamp = COALESCE(NEW.sourceTimestamp, NEW.timestamp),
    timestamp = camera_utc(COALESCE(NEW.sourceTimestamp, NEW.timestamp),
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID)),
    localTimestamp = camera_local(COALESCE(NEW.sourceTimestamp, NEW.timestamp),
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
  WHERE mediaID = NEW.mediaID;
END;
--> statement-breakpoint
CREATE TRIGGER media_camera_source AFTER UPDATE OF sourceTimestamp, deploymentID ON media BEGIN
  UPDATE media SET
    timestamp = camera_utc(NEW.sourceTimestamp,
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID)),
    localTimestamp = camera_local(NEW.sourceTimestamp,
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
  WHERE mediaID = NEW.mediaID;
END;
--> statement-breakpoint
CREATE TRIGGER media_camera_timestamp AFTER UPDATE OF timestamp ON media
WHEN NEW.sourceTimestamp IS OLD.sourceTimestamp
  AND NEW.timestamp IS NOT camera_utc(OLD.sourceTimestamp,
    (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
BEGIN
  UPDATE media SET sourceTimestamp = NEW.timestamp WHERE mediaID = NEW.mediaID;
END;
--> statement-breakpoint
CREATE TRIGGER observations_camera_insert AFTER INSERT ON observations BEGIN
  UPDATE observations SET
    sourceEventStart = COALESCE(NEW.sourceEventStart, NEW.eventStart),
    sourceEventEnd = COALESCE(NEW.sourceEventEnd, NEW.eventEnd),
    eventStart = camera_utc(COALESCE(NEW.sourceEventStart, NEW.eventStart),
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID)),
    eventEnd = camera_utc(COALESCE(NEW.sourceEventEnd, NEW.eventEnd),
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
  WHERE observationID = NEW.observationID;
END;
--> statement-breakpoint
CREATE TRIGGER observations_camera_source AFTER UPDATE OF sourceEventStart, sourceEventEnd, deploymentID ON observations BEGIN
  UPDATE observations SET
    eventStart = camera_utc(NEW.sourceEventStart,
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID)),
    eventEnd = camera_utc(NEW.sourceEventEnd,
      (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
  WHERE observationID = NEW.observationID;
END;
--> statement-breakpoint
CREATE TRIGGER observations_camera_start AFTER UPDATE OF eventStart ON observations
WHEN NEW.sourceEventStart IS OLD.sourceEventStart
  AND NEW.eventStart IS NOT camera_utc(OLD.sourceEventStart,
    (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
BEGIN
  UPDATE observations SET sourceEventStart = NEW.eventStart WHERE observationID = NEW.observationID;
END;
--> statement-breakpoint
CREATE TRIGGER observations_camera_end AFTER UPDATE OF eventEnd ON observations
WHEN NEW.sourceEventEnd IS OLD.sourceEventEnd
  AND NEW.eventEnd IS NOT camera_utc(OLD.sourceEventEnd,
    (SELECT cameraTimeZone FROM deployments WHERE deploymentID = NEW.deploymentID))
BEGIN
  UPDATE observations SET sourceEventEnd = NEW.eventEnd WHERE observationID = NEW.observationID;
END;
