#!/bin/bash
# Archive Podcapp and upload it to TestFlight.
#
# Everything here needs the paid Apple Developer Program: the free Apple ID
# signature that puts the app on Louis's own phone cannot reach App Store
# Connect. See README.md, section TestFlight, for the one-time setup.
#
# Usage (from ios/):
#   TEAM_ID=XXXXXXXXXX \
#   ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#   ASC_KEY_PATH=~/private_keys/AuthKey_XXXXXXXXXX.p8 \
#   ./testflight.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${TEAM_ID:?set TEAM_ID to the Developer Program team id (NOT the personal team)}"
: "${ASC_KEY_ID:?set ASC_KEY_ID (App Store Connect > Users and Access > Integrations)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
: "${ASC_KEY_PATH:?set ASC_KEY_PATH to the downloaded .p8 file}"

# Apple refuses any upload built with an older SDK (iOS 26 SDK minimum since
# 2026-04-28), and the rejection arrives after the whole archive, so check first.
sdk=$(xcrun --sdk iphoneos --show-sdk-version)
if [ "${sdk%%.*}" -lt 26 ]; then
  echo "iOS SDK $sdk is too old: App Store Connect requires the iOS 26 SDK or later." >&2
  echo "Install Xcode 26+ (needs macOS 15.6+) and re-run." >&2
  exit 1
fi

build=$(awk '/CURRENT_PROJECT_VERSION/ {gsub(/[^0-9]/, "", $2); print $2; exit}' project.yml)
version=$(awk -F'"' '/MARKETING_VERSION/ {print $2; exit}' project.yml)
echo "Uploading $version (b$build). App Store Connect rejects a build number it"
echo "has already seen: bump CURRENT_PROJECT_VERSION in project.yml first if in doubt."

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
archive="$out/Podcapp.xcarchive"

cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>upload</string>
	<key>teamID</key><string>$TEAM_ID</string>
	<key>signingStyle</key><string>automatic</string>
	<key>uploadSymbols</key><true/>
	<!-- false, or Xcode rewrites the build number on its own and the b<N>
	     stamp in the onboarding header stops telling the truth. -->
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

xcodebuild archive \
  -project Podcapp.xcodeproj \
  -scheme Podcapp \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID"

xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportOptionsPlist "$out/ExportOptions.plist" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)/$(basename "$ASC_KEY_PATH")" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "Uploaded. Processing takes a few minutes; internal testers get it as soon"
echo "as it finishes, external testers after Beta App Review."
