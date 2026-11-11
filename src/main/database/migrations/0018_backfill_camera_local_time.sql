-- Retain the representation that survived older imports. In particular, Z is
-- an explicit zero offset, not evidence of the camera's original timezone.
-- The 0017 source triggers derive canonical UTC/local values using that input.
-- Do not change camera settings or replace source values from newer imports.
UPDATE deployments SET
  sourceDeploymentStart = COALESCE(sourceDeploymentStart, deploymentStart),
  sourceDeploymentEnd = COALESCE(sourceDeploymentEnd, deploymentEnd)
WHERE (sourceDeploymentStart IS NULL AND deploymentStart IS NOT NULL)
   OR (sourceDeploymentEnd IS NULL AND deploymentEnd IS NOT NULL);
--> statement-breakpoint
UPDATE media SET sourceTimestamp = timestamp
WHERE sourceTimestamp IS NULL AND timestamp IS NOT NULL;
--> statement-breakpoint
-- Also repair an already-retained source whose derived local field is missing.
-- Updating only localTimestamp leaves its existing source and UTC instant alone.
UPDATE media SET localTimestamp = camera_local(sourceTimestamp,
  (SELECT cameraTimeZone FROM deployments WHERE deploymentID = media.deploymentID))
WHERE localTimestamp IS NULL AND sourceTimestamp IS NOT NULL
  AND camera_local(sourceTimestamp,
    (SELECT cameraTimeZone FROM deployments WHERE deploymentID = media.deploymentID)) IS NOT NULL;
--> statement-breakpoint
UPDATE observations SET
  sourceEventStart = COALESCE(sourceEventStart, eventStart),
  sourceEventEnd = COALESCE(sourceEventEnd, eventEnd)
WHERE (sourceEventStart IS NULL AND eventStart IS NOT NULL)
   OR (sourceEventEnd IS NULL AND eventEnd IS NOT NULL);
