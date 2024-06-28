/* import SteamCommunity from "steamcommunity";
import fs from "fs";
import { promises as fsPromises } from "fs";
import * as colors from 'ansi-colors';

const sha1 = require("js-sha1");
const dir = `./static`;
const dirPrices = `./static/prices`;
const dirPricehistory = `./static/pricehistory`;
const itemsBaseUrl = "https://cs2-api.vercel.app/api/en";
const marketBaseURL = "https://steamcommunity.com/market";
const stateFile = `./src/state.json`;
const log = console.log;

const startTime = Date.now();
const maxDuration = 3600 * 1000 * 5.9;

let errorFound = false;

if (process.argv.length !== 4) {
    log(colors.red(`ERROR Missing input arguments, expected 4 got ${process.argv.length}`));
    process.exit(1);
}

const directories = [dir, dirPrices, dirPricehistory];

directories.forEach(directory => {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }
});

const community = new SteamCommunity();

log(colors.green("Logging into Steam community..."));

community.login(
    {
        accountName: process.argv[2],
        password: process.argv[3],
        disableMobile: true,
    },
    async (err: Error | null) => {
        if (err) {
            log(colors.red("login:" + err));
            return;
        }

        try {
            log(colors.green("Loading items..."));
            const items = await getAllItemNames();
            log(colors.blue(`Processing ${items.length} items.`));
            const state = loadState();
            const lastIndex = (state.lastIndex || 0) % items.length;
            await processItems(items.slice(lastIndex), lastIndex);

            const prices = await loadPrices();
            const newPrices = {
                ...prices,
                ...priceDataByItemHashName,
            };
            const orderedNewPrices = Object.keys(newPrices)
                .sort()
                .reduce((acc: any, key) => {
                    acc[key] = newPrices[key];
                    return acc;
                }, {});

            await fsPromises.writeFile(
                `${dirPrices}/latest.json`,
                JSON.stringify(orderedNewPrices, null, 4)
            );
        } catch (error) {
            console.error("An error occurred while processing items:", error);
        }
    }
);

const priceDataByItemHashName: { [key: string]: any } = {};

function loadPrices(): { [key: string]: any } {
    if (fs.existsSync(`${dirPrices}/latest.json`)) {
        const data = fs.readFileSync(`${dirPrices}/latest.json`);
        return JSON.parse(data.toString());
    }
    return {};
}

function loadState(): { lastIndex: number } {
    if (fs.existsSync(stateFile)) {
        const data = fs.readFileSync(stateFile);
        return JSON.parse(data.toString());
    }
    return { lastIndex: 0 };
}

function saveState(state: { lastIndex: number }) {
    fs.writeFileSync(stateFile, JSON.stringify(state));
}

async function getAllItemNames(): Promise<string[]> {
    const endpoints = [
      //  "skins_not_grouped.json",
      //  "stickers.json",
      //  "crates.json",
      //  "agents.json",
      //  "keys.json",
      //  "patches.json",
      //  "graffiti.json",
        "music_kits.json",
      //  "collectibles.json"
    ];

    try {
        const fetchPromises = endpoints.map(endpoint => fetch(`${itemsBaseUrl}/${endpoint}`).then(res => res.json()));
        const results = await Promise.all(fetchPromises);

        return results
            .flat()
            .filter(Boolean)
            .map((item: any) => item.market_hash_name);
    } catch (error) {
        log(colors.red("An error occurred while fetching item names:" + error));
        return [];
    }
}

async function fetchPrice(name: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        community.httpRequestGet(`${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`,
            (err: Error | null, res: any, body: string) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    if (res.statusCode === 429) {
                        errorFound = true;
                        log("ERROR", res.statusCode, res.statusMessage);
                        log(`${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`);
                        resolve([]);
                    }

                    const prices = (JSON.parse(body).prices || []).map(
                        ([time, value, volume]: [string, number, string]) => ({
                            time: Date.parse(time),
                            value,
                            volume: parseInt(volume),
                        })
                    );
                    resolve(prices);
                } catch (parseError) {
                    reject(parseError);
                }
            }
        );
    });
}

async function processBatch(batch: string[]) {
    const promises = batch.map((name) =>
        fetchPrice(name)
            .then(async (prices) => {
                if (prices.length > 0) {
                    priceDataByItemHashName[name] = {
                        steam: getWeightedAveragePrice(prices),
                    };
                    const hashedName = sha1(name);
                    const filteredPrices = prices.splice(-500);
                    await fsPromises.writeFile(
                        `${dir}/pricehistory/${hashedName}.json`,
                        JSON.stringify(filteredPrices)
                    );
                }
            })
            .catch((error) => log(`Error processing ${name}:`, error))
    );
    await Promise.all(promises);
}

async function processItems(items: string[], startIndex: number, batchSize = 1) {
    const requestsPerMinute = 20;
    const delayPerBatch = (60 / requestsPerMinute) * batchSize * 1000;

    for (let i = 0; i < items.length; i += batchSize) {
        const currentTime = Date.now();
        if (currentTime - startTime >= maxDuration) {
            log("Max duration reached. Stopping the process.");
            saveState({ lastIndex: startIndex + i });
            return;
        }

        const batch = items.slice(i, i + batchSize);
        await processBatch(batch);

        if (errorFound) {
            return;
        }

        log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);

        saveState({ lastIndex: startIndex + i + batchSize });

        if (i + batchSize < items.length) {
            log(`Waiting for ${delayPerBatch / 1000} seconds to respect rate limit...`);
            await new Promise((resolve) => setTimeout(resolve, delayPerBatch));
        }
    }
}

function getWeightedAveragePrice(data: { time: number; value: number; volume: number }[]) {
    const now = Date.now();

    const calculateWAP = (days: number) => {
        const limit = now - days * 24 * 60 * 60 * 1000;
        let totalVolume = 0;
        let totalPriceVolumeProduct = 0;

        data.forEach(({ time, value, volume }) => {
            if (time >= limit) {
                totalPriceVolumeProduct += value * volume;
                totalVolume += volume;
            }
        });

        return totalVolume > 0 ? totalPriceVolumeProduct / totalVolume : null;
    };

    return {
        last_24h: calculateWAP(1),
        last_7d: calculateWAP(7),
        last_30d: calculateWAP(30),
        last_90d: calculateWAP(90),
    };
} */

import { SteamMarketFetcher } from "./SteamMarketFetcher";
import * as colors from 'ansi-colors';

const log = console.log;

const main = () => {
    if (process.argv.length !== 4) {
        log(colors.red(`ERROR Missing input arguments, expected 4 got ${process.argv.length}`));
        process.exit(1);
    }

    const accountName = process.argv[2];
    const password = process.argv[3];
    const fetcher = new SteamMarketFetcher(accountName, password);
    fetcher.run();
};

main();
