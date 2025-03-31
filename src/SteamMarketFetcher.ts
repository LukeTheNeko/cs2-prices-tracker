import SteamCommunity from "steamcommunity";
import { getAllItemNames, fetchPrice } from "./utils/apiUtils";
import { loadPrices, loadState, saveState, createDirectories, savePrices } from "./utils/fileUtils";
import { getWeightedAveragePrice } from "./utils/priceUtils";
import { sha1 } from "js-sha1";
import * as fsPromises from "fs/promises";
import * as colors from 'colors';

const dir = `./static`;
const dirPrices = `./static/prices`;
const dirPricehistory = `./static/pricehistory`;
const maxDuration = 3600 * 1000 * 5.7;
const startTime = Date.now();

export class SteamMarketFetcher {
    private community = new SteamCommunity();
    private priceDataByItemHashName: { [key: string]: any } = {};
    private errorFound = false;

    constructor(private accountName: string, private password: string) { }

    async run() {
        createDirectories([dir, dirPrices, dirPricehistory]);
        console.log(colors.magenta.italic("🔑 Logging into Steam community..."));

        this.community.login(
            {
                accountName: this.accountName,
                password: this.password,
                disableMobile: true,
            },
            async (err: Error | null) => {
                if (err) {
                    console.log(colors.red("login:" + err));
                    return;
                }
                await this.processMarketData();
            }
        );
    }

    private async processMarketData() {
        try {
            console.log(colors.magenta.italic("⏳ Loading items..."));
            const items = await getAllItemNames();
            console.log(colors.magenta.bold(`📦 Processing ${items.length} items.`));
            const state = loadState();
            const lastIndex = (state.lastIndex || 0) % items.length;
            await this.processItems(items.slice(lastIndex), lastIndex);

            const prices = await loadPrices();
            const newPrices = {
                ...prices,
                ...this.priceDataByItemHashName,
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

            savePrices(orderedNewPrices);

        } catch (error) {
            console.error("❌ An error occurred while processing items:", error);
        }
    }

    private async processBatch(batch: string[]) {
        const promises = batch.map(name =>
            fetchPrice(this.community, name)
                .then(async prices => {
                    if (prices.length > 0) {
                        this.priceDataByItemHashName[name] = {
                            steam: getWeightedAveragePrice(prices),
                        };
                        const hashedName = sha1(name);
                        const filteredPrices = prices.splice(-500);
                        await fsPromises.writeFile(
                            `${dirPricehistory}/${hashedName}.json`,
                            JSON.stringify(filteredPrices)
                        );
                    }
                })
                .catch(error => console.log(`Error processing ${name}:`, error))
        );
        await Promise.all(promises);
    }

    private async processItems(items: string[], startIndex: number, batchSize = 1) {
        const requestsPerMinute = 20;
        const delayPerBatch = (60 / requestsPerMinute) * batchSize * 1000;

        for (let i = 0; i < items.length; i += batchSize) {
            const currentTime = Date.now();
            if (currentTime - startTime >= maxDuration) {
                console.log(colors.green("⏰ Max duration reached. Stopping the process."));
                saveState({ lastIndex: startIndex + i });
                return;
            }

            const batch = items.slice(i, i + batchSize);
            await this.processBatch(batch);

            if (this.errorFound) {
                return;
            }

            console.log(colors.blue(`☑️ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`));

            saveState({ lastIndex: startIndex + i + batchSize });

            if (i + batchSize < items.length) {
                console.log(colors.cyan(`⌛ Waiting for ${delayPerBatch / 1000} seconds to respect rate limit...`));
                await new Promise(resolve => setTimeout(resolve, delayPerBatch));
            }
        }
    }
}
