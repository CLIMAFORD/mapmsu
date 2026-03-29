Deployment instructions for GitHub Pages

1) Verify the repository has a `main` or `master` branch.

2) Review the created workflow at `.github/workflows/deploy.yml`.

3) Commit and push these changes to the repository. Example:

   git add .agent.md .github/workflows/deploy.yml DEPLOY.md
   git commit -m "Add Pages deploy workflow and agent config"
   git push origin main

4) In the repository on GitHub: Settings -> Pages, confirm the site source or
   allow the workflow to publish to the `gh-pages` branch. The workflow will
   run on pushes to `main`/`master` and publish the repository static files.

5) (Optional) To use a custom domain, add `CNAME` to the repository root and
   configure DNS records per GitHub Pages instructions.

Notes:
- The workflow uses the repository root as `publish_dir` — if you prefer to
  deploy only a subset (for example, a `docs/` folder), update `publish_dir`.
- You may need to enable Pages permissions for GitHub Actions in the repo
  settings if the site doesn't publish automatically.
