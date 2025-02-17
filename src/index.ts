import { SteamMarketFetcher } from "./SteamMarketFetcher";
import * as colors from 'ansi-colors';

const log = console.log;

const main = () => {
    if (process.argv.length !== 4) {
        log(colors.red(`❌ ERROR Missing input arguments, expected 4 got ${process.argv.length}`));
        process.exit(1);
    }

    const accountName = process.argv[2];
    const password = process.argv[3];
    const fetcher = new SteamMarketFetcher(accountName, password);
    fetcher.run();
};

main();
