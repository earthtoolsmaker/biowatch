"""
CLI script to run SpeciesNet as a LitServer.


Start the server with the default parameter values:

```
run_speciesnet_server.py
```

Override the parameters:

```
run_speciesnet_server.py \
  --port 8000 \
  --timeout 30 \
  --workers_per_device 1 \
  --backlog 2048 \
  --model kaggle:google/speciesnet/keras/v4.0.0a \
  --geofence true
```

Load the SpeciesNet model from a folder and start the server:

```
run_speciesnet_server.py \
  --port 8000 \
  --model "v4.0.1a/"
```

A Swagger API documentation is served at localhost:${port}/docs

health:

```
$ curl http://localhost:${port}/health
"ok"
```

info:

```
$ curl http://localhost:${port}/info

{
  "model": {
    "name": "kaggle:google/speciesnet/keras/v4.0.0a",
    "type": "speciesnet"
  },
  "server": {
    "devices": [
      [
        "cuda:0"
      ]
    ],
    "workers_per_device": 1,
    "timeout": 30,
    "stream": true,
    "max_payload_size": null,
    "track_requests": false
  }
}
```

predict (streaming):

```
$ curl -X POST http://localhost:${port}/predict \
-H "Content-Type: application/json" \
-d '{
    "instances": [
        {
            "filepath": "/path/to/your/image"
        },
      ]
    }


{
  "output": {
    "predictions": [
      {
        "classifications": {
          "classes": [
            "a8479038-dd45-40b3-bd78-dd07c2763153;mammalia;dasyuromorphia;dasyuridae;dasyurus;maculatus;spotted-tailed quoll",
            "e88777aa-294e-47ec-8c8a-d4081c0abaff;mammalia;dasyuromorphia;dasyuridae;dasyurus;hallucatus;northern quoll",
            "32c0147f-1967-4644-b107-8133ae1f020a;mammalia;rodentia;cuniculidae;cuniculus;paca;spotted paca",
            "4c88622d-efe4-42af-9a54-e3b7a76c3b85;mammalia;rodentia;nesomyidae;cricetomys;gambianus;gambian rat",
            "f2d233e3-80e3-433d-9687-e29ecc7a467a;mammalia;;;;;mammal"
          ],
          "scores": [
            0.37654027342796326,
            0.12218287587165833,
            0.09088445454835892,
            0.06837189197540283,
            0.03167106956243515
          ]
        },
        "detections": [
          {
            "bbox": [
              0.334285706281662,
              0.33838382363319397,
              0.25999999046325684,
              0.3611111044883728
            ],
            "category": "1",
            "conf": 0.9705691337585449,
            "label": "animal"
          }
        ],
        "filepath": "/path/to/your/image",
        "model_version": "4.0.0a",
        "prediction": "f2d233e3-80e3-433d-9687-e29ecc7a467a;mammalia;;;;;mammal",
        "prediction_score": 0.6896505653858185,
        "prediction_source": "classifier+rollup_to_class"
      }
    ]
  }
}
```
"""

from typing import Optional

import litserve as ls
from absl import app, flags
from fastapi import HTTPException
from speciesnet import DEFAULT_MODEL, SpeciesNet, file_exists

_PORT = flags.DEFINE_integer(
    "port",
    8000,
    "Port to run the server on.",
)
_API_PATH = flags.DEFINE_string(
    "api_path",
    "/predict",
    "URL path for the server endpoint.",
)
_WORKERS_PER_DEVICE = flags.DEFINE_integer(
    "workers_per_device",
    1,
    "Number of server replicas per device.",
)
_TIMEOUT = flags.DEFINE_integer(
    "timeout",
    30,
    "Timeout (in seconds) for requests.",
)
_BACKLOG = flags.DEFINE_integer(
    "backlog",
    2048,
    "Maximum number of connections to hold in backlog.",
)
_MODEL = flags.DEFINE_string(
    "model",
    DEFAULT_MODEL,
    "SpeciesNet model to load.",
)
_GEOFENCE = flags.DEFINE_bool(
    "geofence",
    True,
    "Whether to enable geofencing or not.",
)
_EXTRA_FIELDS = flags.DEFINE_list(
    "extra_fields",
    None,
    "Comma-separated list of extra fields to propagate from request to response.",
)
_COUNTRY = flags.DEFINE_string(
    "country",
    None,
    "ISO 3166-1 alpha-3 three-letter country code for geofencing (e.g., GBR, USA, FRA).",
)


class SpeciesNetLitAPI(ls.LitAPI):
    """Core API to serve the SpeciesNet model.

    This class implements the server side of SpeciesNet by implementing LitAPI interface
    required by the `litserve` library. It handles request parsing, model loading,
    inference, and response formatting. This is a bridge between HTTP requests and the
    internal Python API for SpeciesNet.
    """

    def __init__(
        self,
        model_name: str,
        geofence: bool = True,
        country: Optional[str] = None,
        extra_fields: Optional[list[str]] = None,
        *args,
        **kwargs,
    ) -> None:
        """Initializes the SpeciesNet API server.

        Args:
                model_name:
                        String value identifying the model to be loaded. It can be a Kaggle
                        identifier (starting with `kaggle:`), a HuggingFace identifier (starting
                        with `hf:`) or a local folder to load the model from.
                geofence:
                        Whether to enable geofencing or not. Defaults to `True`.
                country:
                        ISO 3166-1 alpha-3 three-letter country code for geofencing.
                extra_fields:
                          Comma-separated list of extra fields to propagate from request to
                          response.
        """
        super().__init__(*args, **kwargs)
        self.model_name = model_name
        self.geofence = geofence
        self.country = country
        self.extra_fields = extra_fields or []

    def setup(self, device):
        del device  # Unused.
        # Initialize SpeciesNet with geofence only - country will be passed during prediction
        self.model = SpeciesNet(self.model_name, geofence=self.geofence)

    def decode_request(self, request, **kwargs):
        for instance in request["instances"]:
            filepath = instance["filepath"]
            if not file_exists(filepath):
                raise HTTPException(400, f"Cannot access filepath: `{filepath}`")
        return request

    def _propagate_extra_fields(
        self,
        instances_dict: dict,
        predictions_dict: dict,
    ) -> dict:
        predictions = predictions_dict["predictions"]
        new_predictions = {p["filepath"]: p for p in predictions}
        for instance in instances_dict["instances"]:
            for field in self.extra_fields:
                if field in instance:
                    new_predictions[instance["filepath"]][field] = instance[field]
        return {"predictions": list(new_predictions.values())}

    def predict(self, x, **kwargs):

        for instance in x["instances"]:
            filepath = instance["filepath"]

            # Create instance dict with filepath and optionally country
            instance_data = {"filepath": filepath}
            if self.country:
                instance_data["country"] = self.country

            single_instances_dict = {"instances": [instance_data]}

            single_predictions_dict = self.model.predict(
                instances_dict=single_instances_dict
            )
            assert single_predictions_dict is not None
            yield self._propagate_extra_fields(
                single_instances_dict, single_predictions_dict
            )

    def encode_response(self, output, **kwargs):
        for out in output:
            yield {"output": out}


def main(argv: list[str]) -> None:
    del argv  # Unused.

    api = SpeciesNetLitAPI(
        model_name=_MODEL.value,
        geofence=_GEOFENCE.value,
        country=_COUNTRY.value,
        extra_fields=_EXTRA_FIELDS.value,
        api_path=_API_PATH.value,
        stream=True,
    )
    print("SpeciesNet API server initialized with country:", _COUNTRY.value)
    model_metadata = {"name": _MODEL.value, "type": "speciesnet"}
    server = ls.LitServer(
        api,
        accelerator="auto",
        devices="auto",
        workers_per_device=_WORKERS_PER_DEVICE.value,
        model_metadata=model_metadata,
        timeout=_TIMEOUT.value,
        enable_shutdown_api=True,
    )
    server.run(
        port=_PORT.value,
        generate_client_file=False,
        backlog=_BACKLOG.value,
    )


if __name__ == "__main__":
    app.run(main)
