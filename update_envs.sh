#!/bin/bash
TOKEN="2|5BX16K99yFEoihLtx0gsb9cPoZXN6IblgDx7bwCkae3d2105"
API="http://207.180.248.233:8000/api/v1/applications"

APP_ID=$1
shift
ENVS=("$@")

for ENV in "${ENVS[@]}"; do
  KEY="${ENV%%=*}"
  VAL="${ENV#*=}"
  
  # Try PATCH first
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\", \"value\":\"$VAL\"}" "$API/$APP_ID/envs")
  
  if [ "$RESPONSE" != "200" ] && [ "$RESPONSE" != "201" ]; then
    # If PATCH fails (maybe because it doesn't exist), try POST
    curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\", \"value\":\"$VAL\"}" "$API/$APP_ID/envs" > /dev/null
    echo "POSTed $KEY=$VAL to $APP_ID"
  else
    echo "PATCHed $KEY=$VAL to $APP_ID"
  fi
done
