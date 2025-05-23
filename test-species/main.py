from speciesnet.utils import prepare_instances_dict
from speciesnet import SpeciesNet
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import argparse
from PIL import Image
import json

app = Flask(__name__)
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

model_name = "kaggle:google/speciesnet/keras/v4.0.0a"
_model = None

def get_model():
    global _model
    if _model is None:
        _model = SpeciesNet(
                    model_name,
                    components="all",
                    geofence=False,
                    # Uncomment the line below if you want to run your own custom ensembling
                    # routine. And also, implement that routine! :-)
                    # combine_predictions_fn=custom_combine_predictions_fn,
                    multiprocessing=True,
                )
    return _model

@app.route('/', methods=['GET'])
def health_check():
  return jsonify({"status": "healthy"}), 200

@app.route('/predict', methods=['GET'])
def detect_bear():
    try:
        folder_path = request.args.get('path')  # restore query parameter
        if not folder_path:
            return jsonify({"error": "No folder path provided."}), 400

        path = Path(folder_path)
        if not path.exists():
            return jsonify({"error": f"Image not found: {folder_path}"}), 404

        try:
            model = get_model()
            instances_dict = prepare_instances_dict(folders=[folder_path])
            predictions_dict = model.predict(
                instances_dict=instances_dict
            )

            return jsonify(predictions_dict)
        except Exception as e:
            print(e)
            return jsonify({
                "folder_path": str(path),
                "error": str(e)
            }), 500

    except Exception as e:
        print(e)
        return jsonify({'error': str(e)}), 500


def main(path):
    print(f"Starting flask server with path {path}")
    # app.run(path=path)
    print(f"Processing directory: {path}")
    model = get_model()
    instances_dict = prepare_instances_dict(folders=[path], country='NLD')
    predictions_dict = model.predict(
        instances_dict=instances_dict,
        progress_bars=True,
    )
    for item in predictions_dict['predictions']:
        print("PREDICTION: " + json.dumps(item))
    print(json.dumps(predictions_dict['predictions'], indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--path', type=str, default='.', help='Path to the directory to process')
    args = parser.parse_args()
    main(args.path)
