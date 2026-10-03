INSERT INTO "DeviceAdapterRegistry" (
  "id","key","name","vendor","version","protocols","deviceKinds","capabilities",
  "supportsEdgeAgent","supportsDiscovery","requiredEntitlement","isActive","updatedAt"
) VALUES
(
  'adapter_generic_webhook','GENERIC_WEBHOOK','Generic Webhook Adapter',NULL,'1.0.0',
  ARRAY['WEBHOOK']::"ConnectedDeviceProtocol"[],
  ARRAY['BIOMETRIC','RFID','GPS','CAMERA','ACCESS_CONTROL','ENVIRONMENT_SENSOR','EDGE_GATEWAY','OTHER']::"ConnectedDeviceKind"[],
  ARRAY['INGEST','HEARTBEAT','SIGNED_EVENTS']::TEXT[],
  false,false,'connectedCampus',true,CURRENT_TIMESTAMP
),
(
  'adapter_ais140_http','AIS140_HTTP','AIS-140 GPS Adapter','AIS-140','1.0.0',
  ARRAY['WEBHOOK','REST_PULL','TCP_PUSH']::"ConnectedDeviceProtocol"[],
  ARRAY['GPS']::"ConnectedDeviceKind"[],
  ARRAY['GPS','SPEED','IGNITION','HEADING','GEOFENCE','ETA']::TEXT[],
  false,false,'transport',true,CURRENT_TIMESTAMP
),
(
  'adapter_onvif_rtsp','ONVIF_RTSP','ONVIF / RTSP Camera Adapter','ONVIF','1.0.0',
  ARRAY['ONVIF','RTSP']::"ConnectedDeviceProtocol"[],
  ARRAY['CAMERA']::"ConnectedDeviceKind"[],
  ARRAY['DISCOVERY','HEALTH','LIVE_VIEW','PLAYBACK','EVENTS']::TEXT[],
  true,true,'connectedCampus',true,CURRENT_TIMESTAMP
),
(
  'adapter_edge_lan','EDGE_LAN','Connected Campus Edge LAN Adapter',NULL,'1.0.0',
  ARRAY['SDK','MQTT','TCP_PUSH','REST_PULL']::"ConnectedDeviceProtocol"[],
  ARRAY['BIOMETRIC','RFID','GPS','CAMERA','ACCESS_CONTROL','ENVIRONMENT_SENSOR','EDGE_GATEWAY','OTHER']::"ConnectedDeviceKind"[],
  ARRAY['DISCOVERY','OFFLINE_QUEUE','RETRY','SIGNED_EVENTS','REMOTE_DIAGNOSTICS']::TEXT[],
  true,true,'connectedCampus',true,CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name"=EXCLUDED."name",
  "vendor"=EXCLUDED."vendor",
  "version"=EXCLUDED."version",
  "protocols"=EXCLUDED."protocols",
  "deviceKinds"=EXCLUDED."deviceKinds",
  "capabilities"=EXCLUDED."capabilities",
  "supportsEdgeAgent"=EXCLUDED."supportsEdgeAgent",
  "supportsDiscovery"=EXCLUDED."supportsDiscovery",
  "requiredEntitlement"=EXCLUDED."requiredEntitlement",
  "isActive"=EXCLUDED."isActive",
  "updatedAt"=CURRENT_TIMESTAMP;
