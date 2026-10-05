# Baseline vs Optimized Backend

## BASELINE
- Uses the existing Phaser movement/pathfinding directly.
- No WebSocket connection to the backend.
- No Python process.
- No ML prediction.
- No robot-to-robot P2P coordination.
- No software safety gate.
- This is the straight/original execution used as the comparison baseline.

## OPTIMIZED
- The browser connects to `ws://127.0.0.1:3001` only when OPTIMIZED is selected.
- Each robot gets its own local edge-agent process.
- Each edge-agent loads `ml/amr_decision_model.pkl` + `ml/amr_preprocessor.pkl`.
- Robot state is multicast to the robot's zone and neighboring zones.
- Agents detect near-term vertex/opposite-edge conflicts from the actual frontend path.
- Each agent runs the supplied ML model and multicasts `ML_DECISION`.
- Agents exchange peer ML decisions and independently converge on a final `MOVE`, `WAIT`, `SLOW`, or `REROUTE` action.
- The browser applies the final edge decision to the corresponding Phaser robot.
- `REROUTE` uses the frontend logical road graph and avoids the contested node/corridor.
- Optimized mode also has a deterministic local safety gate so a delayed packet cannot make two robots enter the same logical resource.

## Run

Terminal 1:
```powershell
npm run server
```

Terminal 2:
```powershell
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:3000`.

Python dependencies:
```powershell
python -m pip install -r requirements.txt
```

The trained model requires `scikit-learn==1.9.0`.

## Backend logs

In the `npm run server` terminal you should see all P2P and ML traffic, for example:

```text
[P2P][Robot-01] TX -> ROBOT_STATE
[P2P][Robot-02] RX <- ROBOT_STATE
[P2P][Robot-01] ML PREDICTION ...
[P2P][Robot-01] TX -> ML_DECISION
[P2P][Robot-02] RX <- ML_DECISION
[P2P][Robot-01] FINAL DECISION ...
[P2P][Robot-01] TX -> DECISION
[P2P][Robot-02] RX <- DECISION
```

BASELINE should not produce these ML/P2P robot messages because the bridge is disabled in BASELINE mode.
