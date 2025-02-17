import fs from 'fs';
import path from 'path';

const dirPrices = `./static/prices`;
const stateFile = `./src/state.json`;

export function createDirectories(directories: string[]) {
    directories.forEach(directory => {
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory);
        }
    });
}

export function getCurrentDate(): string {
    return new Date().toISOString().split('T')[0];
}

export function savePrices(orderedNewPrices: any) {
    const currentDate = getCurrentDate();
    const dirPath = path.join(dirPrices, 'date');

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFile(
        `${dirPath}/${currentDate}.json`,
        JSON.stringify(orderedNewPrices, null, 4),
        (err) => {
            if (err) {
                console.error(err);
            }
        }
    );
}

export function loadPrices(): { [key: string]: any } {
    if (fs.existsSync(`${dirPrices}/latest.json`)) {
        const data = fs.readFileSync(`${dirPrices}/latest.json`);
        return JSON.parse(data.toString());
    }
    return {};
}

export function loadState(): { lastIndex: number } {
    if (fs.existsSync(stateFile)) {
        const data = fs.readFileSync(stateFile);
        return JSON.parse(data.toString());
    }
    return { lastIndex: 0 };
}

export function saveState(state: { lastIndex: number }) {
    fs.writeFileSync(stateFile, JSON.stringify(state));
}