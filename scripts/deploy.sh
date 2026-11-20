#!/bin/sh
# Uploads the bundle (the zip `npm run bundle` writes) to the bucket folder behind this page's subdomain and
# invalidates that folder in CloudFront. One wildcard distribution serves every `*.apps-dev.chatic.io`
# page: its viewer-request function turns the host's first label into the bucket folder, so a new page is
# a new folder and never a change to CloudFront, the certificate or DNS.
#
#   DEPLOY_BUCKET            bucket and folder: my-bucket/dou-closer-word (the folder = the subdomain)
#   DEPLOY_DISTRIBUTION_ID   the CloudFront distribution in front of the bucket
#   DEPLOY_HOST              the domain the folder is served under (default apps-dev.chatic.io)
#   AWS_PROFILE              optional, picked up by the aws CLI
#   DEPLOY_DRY_RUN=1         list what would change, upload nothing, skip the invalidation
#
# Values come from the environment or from .env.deploy (git-ignored; see .env.deploy.example).
# DEPLOY_ENV_FILE picks another file, such as .env.deploy.prod for *.apps.chatic.io.
set -eu

cd "$(dirname "$0")/.."

env_file="${DEPLOY_ENV_FILE:-.env.deploy}"
if [ -f "$env_file" ]; then
  set -a
  . "./$env_file"
  set +a
fi

: "${DEPLOY_BUCKET:?Set DEPLOY_BUCKET (in the environment or .env.deploy)}"
: "${DEPLOY_DISTRIBUTION_ID:?Set DEPLOY_DISTRIBUTION_ID (in the environment or .env.deploy)}"

bucket="${DEPLOY_BUCKET%/}"
folder="${bucket#*/}"
if [ "$folder" = "$bucket" ] || [ -z "$folder" ]; then
  echo "DEPLOY_BUCKET must name the page's folder: <bucket>/<subdomain>" >&2
  exit 1
fi

zip="dou-closer-word.zip"
[ -f "$zip" ] || { echo "$zip is missing: run npm run bundle first" >&2; exit 1; }
site="$(mktemp -d)"
trap 'rm -rf "$site"' EXIT
unzip -q "$zip" -d "$site"

target="s3://$bucket"
dryrun=""
[ "${DEPLOY_DRY_RUN:-}" = "1" ] && dryrun="--dryrun" && echo "Dry run: nothing is uploaded or invalidated."

# Hashed assets first, cached for good, so the new index.html never points at a file not there yet.
aws s3 sync "$site/assets" "$target/assets" $dryrun --cache-control "public, max-age=31536000, immutable"
# index.html and the manifest are revalidated on every load.
aws s3 sync "$site" "$target" $dryrun --delete --exclude "assets/*" --cache-control "no-cache"
aws s3 cp "$site/.well-known/chatic-app.json" "$target/.well-known/chatic-app.json" $dryrun \
  --content-type application/json --cache-control "no-cache"

if [ -z "$dryrun" ]; then
  # The function rewrites the path before caching, so the cached keys are under /<folder>/.
  aws cloudfront create-invalidation --distribution-id "$DEPLOY_DISTRIBUTION_ID" --paths "/$folder/*" \
    --query 'Invalidation.{Id:Id,Status:Status}' --output text
  echo "Deployed to $target — https://$folder.${DEPLOY_HOST:-apps-dev.chatic.io}/"
fi
