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

6) If the workflow cannot push to `gh-pages` due to permissions, you can
   provide a Personal Access Token (PAT) instead of using the runner token.

   - Create a PAT on GitHub (Settings -> Developer settings -> Personal access tokens) with the `repo` scope (at least `public_repo` or `repo` for private repos).
   - In the repository, go to Settings -> Secrets and variables -> Actions -> New repository secret and add the token as `GH_PAGES_PAT`.
   - The workflow at `.github/workflows/deploy.yml` is already configured to use `GH_PAGES_PAT`.

   After adding the secret you can re-run the deploy workflow (Actions -> Deploy workflow -> Run workflow) or push to `main`/`master` to trigger it.

Notes:
- The workflow uses the repository root as `publish_dir` — if you prefer to
  deploy only a subset (for example, a `docs/` folder), update `publish_dir`.
- You may need to enable Pages permissions for GitHub Actions in the repo
  settings if the site doesn't publish automatically.

Supabase setup (quick):

- Create a Storage bucket named `issue-photos` in the Supabase project Storage -> Buckets. Set public if you want public image URLs.
- Run the SQL in `supabase_init.sql` (SQL editor) to create the `issues`, `active_users`, and layer tables.
- Configure Row Level Security (RLS) and policies as you require. For anonymous reporting you can permit INSERT on `issues` and `active_users` to the `anon` role (exercise caution).
- In `index.html` the Supabase project URL and anon key are embedded for the client. If you rotate the key, update `js/app.js` accordingly.

Security note: Do not commit service_role keys or DB passwords to the repo. The `supabase_init.sql` file is safe to commit; running it requires appropriate privileges.
