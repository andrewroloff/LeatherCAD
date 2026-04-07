#include <vector>
#include <emscripten/bind.h>

using namespace emscripten;

// --------------------
// Core Data Structures
// --------------------

struct Guide
{
    bool vertical; // true = vertical (x), false = horizontal (y)
    float pos;     // x or y depending on orientation

    Guide() : vertical(false), pos(0) {}
    Guide(bool v, float p) : vertical(v), pos(p) {}
};

struct Node
{
    float x;
    float y;
    float r; // radius for rounding (future use)

    Node() : x(0), y(0), r(0) {}
    Node(float x_, float y_) : x(x_), y(y_), r(0) {}
};

struct Polyline
{
    std::vector<Node> nodes;

    void addNode(float x, float y)
    {
        nodes.emplace_back(x, y);
    }

    int size() const
    {
        return nodes.size();
    }

    Node &get(int i)
    {
        return nodes[i];
    }
};

struct Entity
{
    // For now: only polyline
    Polyline polyline;
};

// --------------------
// Document (Main Engine)
// --------------------

class Document
{
public:
    std::vector<Entity> entities;
    std::vector<Guide> guides;

    Document() {}

    // Create new polyline and return its index
    int createPolyline()
    {
        entities.emplace_back();
        return entities.size() - 1;
    }

    // Add node to a polyline
    void addNodeToPolyline(int index, float x, float y)
    {
        if (index < 0 || index >= entities.size())
            return;
        entities[index].polyline.addNode(x, y);
    }

    // Accessors for rendering
    int entityCount() const
    {
        return entities.size();
    }

    Polyline &getPolyline(int index)
    {
        return entities[index].polyline;
    }

    void moveNode(int polyIndex, int nodeIndex, float x, float y)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        auto &poly = entities[polyIndex].polyline;

        if (nodeIndex < 0 || nodeIndex >= poly.nodes.size())
            return;

        poly.nodes[nodeIndex].x = x;
        poly.nodes[nodeIndex].y = y;
    }

    void removeNodeFromPolyline(int polyIndex, int nodeIndex)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;
        auto &nodes = entities[polyIndex].polyline.nodes;
        if (nodeIndex < 0 || nodeIndex >= nodes.size())
            return;
        nodes.erase(nodes.begin() + nodeIndex);
    }

    void insertNodeInPolyline(int polyIndex, int nodeIndex, float x, float y)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        auto &nodes = entities[polyIndex].polyline.nodes;

        if (nodeIndex < 0)
            nodeIndex = 0;
        if (nodeIndex > nodes.size())
            nodeIndex = nodes.size(); // insert at end if past size

        nodes.insert(nodes.begin() + nodeIndex, Node(x, y));
    }

    void addGuide(bool vertical, float pos)
    {
        guides.emplace_back(vertical, pos);
    }

    int guideCount() const
    {
        return guides.size();
    }

    Guide &getGuide(int i)
    {
        return guides[i];
    }

    void removeGuide(int i)
    {
        if (i < 0 || i >= guides.size())
            return;
        guides.erase(guides.begin() + i);
    }

    void moveGuide(int i, float pos)
    {
        guides[i].pos = pos;
    }
};

// --------------------
// Embind Bindings
// --------------------

EMSCRIPTEN_BINDINGS(geometry_module)
{
    value_object<Guide>("Guide")
        .field("vertical", &Guide::vertical)
        .field("pos", &Guide::pos);

    value_object<Node>("Node")
        .field("x", &Node::x)
        .field("y", &Node::y)
        .field("r", &Node::r);

    class_<Polyline>("Polyline")
        .function("size", &Polyline::size)
        .function("get", &Polyline::get, allow_raw_pointers());

    class_<Document>("Document")
        .constructor<>()
        .function("createPolyline", &Document::createPolyline)
        .function("addNodeToPolyline", &Document::addNodeToPolyline)
        .function("entityCount", &Document::entityCount)
        .function("getPolyline", &Document::getPolyline, allow_raw_pointers())
        .function("removeNodeFromPolyline", &Document::removeNodeFromPolyline)
        .function("insertNodeInPolyline", &Document::insertNodeInPolyline)
        .function("moveNode", &Document::moveNode)
        .function("addGuide", &Document::addGuide)
        .function("guideCount", &Document::guideCount)
        .function("getGuide", &Document::getGuide, allow_raw_pointers())
        .function("removeGuide", &Document::removeGuide)
        .function("moveGuide", &Document::moveGuide);
}