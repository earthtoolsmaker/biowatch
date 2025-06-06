# curl -X POST http://localhost:8000/predict \
# -H "Content-Type: application/json" \
# -d '{
#     "instances": [
#         {
#             "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image1.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         },
#         {
#
#               "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
#         }
#     ]
# }'

curl -X POST http://localhost:8000/predict \
-H "Content-Type: application/json" \
-d '{
    "instances": [
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/badger.JPG"
        },
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/fox1.JPG"
        },
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/sheep.JPG"
        },
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/chamois1.JPG"
        },
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/human11.JPG"
        },
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/vehicle.JPG"
        }
    ]
}'
