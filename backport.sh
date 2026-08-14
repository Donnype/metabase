git reset HEAD~1
rm ./backport.sh
git cherry-pick e29527e5b3f0e330d5d0e201ae9fe590a1d6bc96
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
