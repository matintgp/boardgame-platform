# Third-party notices

## Stockfish 18

This product bundles **Stockfish**, a free UCI chess engine.

- **Version / tag:** Stockfish 18 (`sf_18`)
- **Project:** https://stockfishchess.org/
- **Source:** https://github.com/official-stockfish/Stockfish
- **License:** GNU General Public License v3.0 (GPLv3)
- **Binary path (container):** `/usr/local/bin/stockfish` (`STOCKFISH_PATH`)

Corresponding source for the exact tag used in the Docker build is available from
the GitHub repository above (`git clone --branch sf_18`). A copy of the GPLv3
license text is available at https://www.gnu.org/licenses/gpl-3.0.html.

Stockfish is used **only server-side** via the UCI protocol (`python-chess`).
Clients do not receive engine evaluation, principal variation, or raw UCI options.

## python-chess

- **License:** GPL-3.0+
- **Project:** https://github.com/niklasf/python-chess

When distributing a modified version of this backend that includes Stockfish
and/or python-chess, comply with GPLv3 source disclosure obligations.
