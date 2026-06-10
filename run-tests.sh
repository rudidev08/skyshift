#!/bin/bash
# Run all *.test.ts files in the project

failed=0
passed=0
errors=""

for file in $(find src/tests -name '*.test.ts' | sort); do
  printf "  %-50s" "$file"
  output=$(dev/run-test-file.sh "$file" 2>&1)
  if [ $? -eq 0 ]; then
    echo "✓"
    ((passed++))
  else
    echo "✗"
    errors="$errors\n--- $file ---\n$output\n"
    ((failed++))
  fi
done

echo ""
echo "$passed passed, $failed failed"

if [ $failed -gt 0 ]; then
  echo -e "\nFailures:$errors"
  exit 1
fi
