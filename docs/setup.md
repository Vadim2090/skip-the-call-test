# Setup

Three ways to run it. The first needs nothing but a Google account.

## A. Paste into a Google Sheet (5 minutes, no tools)

1. Create a blank Google Sheet.
2. **Extensions → Apps Script**. Delete the default `Code.gs` content.
3. Create four script files and paste the contents of the matching repo file into each:
   `stats.js`, `engine.js`, `synthetic.js`, `sheets.js` (the editor names them `.gs`; the code
   is the same). Order does not matter: Apps Script loads every file into one scope.
4. Save, go back to the sheet, reload the page. A **Skip-the-Call** menu appears.
5. **Skip-the-Call → Load synthetic example** to see every tab filled, or
   **1. Create Config and Events tabs** to start with your own data.
6. Fill **Config**, paste your subjects into **Events** (one row each, see
   `docs/data-contract.md`), then **2. Build plan** and **3. Run readout**.

The first run asks for authorization: the script reads and writes this spreadsheet only.

## B. Push with clasp (if you want the repo to be the source of truth)

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "Skip-the-Call test" --rootDir .
clasp push
```

`.claspignore` sends only `src/*.js` and `appsscript.json`. Open the created sheet, reload,
and the menu is there.

## C. Run locally with Node (no Google account)

```bash
node examples/generate.js          # writes examples/events.csv (2,400 synthetic subjects)
node examples/demo.js              # prints Plan, Readout, Maturation, Checks
node examples/demo.js examples/config-midtest.csv    # the same data read in the middle of the test
node --test tests/*.test.js        # 18 tests
```

`examples/demo.js` takes any `config.csv` and `events.csv` in the Events format, so it also
works on your real export without a Sheet.

## Reading order after a run

1. **Checks**. Anything FAIL means the pooled Readout is not the number to decide on.
2. **Readout**, the primary endpoint block: the mature rates, the interval of the difference,
   the non-inferiority verdict.
3. **Readout**, "qualified by any route": the endpoint that includes the call's second route.
4. **Maturation**, only if you are reading before the freeze + window date.
