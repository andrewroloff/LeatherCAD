#include <vector>
#include <emscripten/bind.h>
#include <cmath>

using namespace emscripten;

// --------------------
// Core Data Structures
// --------------------

struct Guide
{
    bool vertical;
    float pos;

    Guide() : vertical(false), pos(0) {}
    Guide(bool v, float p) : vertical(v), pos(p) {}
};

struct Node
{
    float x;
    float y;
    float r;

    Node() : x(0), y(0), r(0) {}
    Node(float x_, float y_) : x(x_), y(y_), r(0) {}
};

class Document; // forward declare

// --------------------
// Polyline (NEW SYSTEM)
// --------------------

struct Polyline
{
    std::vector<int> nodeIndices;
    Document *doc = nullptr; // 🔥 key fix (no STL exposed to JS)

    int size() const
    {
        return nodeIndices.size();
    }

    Node get(int i) const;
};

// --------------------
// Entity
// --------------------

struct Entity
{
    Polyline polyline;
};

// --------------------
// Document
// --------------------

class Document
{
public:
    std::vector<Entity> entities;
    std::vector<Guide> guides;
    std::vector<Node> nodePool;

    Document() {}

    // --------------------
    // Node creation
    // --------------------

    int createNode(float x, float y)
    {
        nodePool.emplace_back(x, y);
        return nodePool.size() - 1;
    }

    // --------------------
    // Polyline creation
    // --------------------

    int createPolyline()
    {
        entities.emplace_back();
        entities.back().polyline.doc = this; // 🔥 attach doc
        return entities.size() - 1;
    }

    // --------------------
    // Add node
    // --------------------

    void addNodeToPolyline(int polyIndex, float x, float y)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        int id = createNode(x, y);
        entities[polyIndex].polyline.nodeIndices.push_back(id);
    }

    // --------------------
    // Access
    // --------------------

    int entityCount() const
    {
        return entities.size();
    }

    Polyline &getPolyline(int index)
    {
        return entities[index].polyline;
    }

    Node getNodeFromPolyline(int polyIndex, int nodeIndex)
    {
        int id = entities[polyIndex].polyline.nodeIndices[nodeIndex];
        return nodePool[id];
    }

    // --------------------
    // Move node
    // --------------------

    void moveNode(int polyIndex, int nodeIndex, float x, float y)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        auto &poly = entities[polyIndex].polyline;

        if (nodeIndex < 0 || nodeIndex >= poly.nodeIndices.size())
            return;

        int id = poly.nodeIndices[nodeIndex];
        nodePool[id].x = x;
        nodePool[id].y = y;
    }

    // --------------------
    // Remove node reference (not pool deletion)
    // --------------------

    void removeNodeFromPolyline(int polyIndex, int nodeIndex)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        auto &nodes = entities[polyIndex].polyline.nodeIndices;

        if (nodeIndex < 0 || nodeIndex >= nodes.size())
            return;

        nodes.erase(nodes.begin() + nodeIndex);
    }

    // --------------------
    // Insert node
    // --------------------

    void insertNodeInPolyline(int polyIndex, int nodeIndex, float x, float y)
    {
        if (polyIndex < 0 || polyIndex >= entities.size())
            return;

        int id = createNode(x, y);

        auto &nodes = entities[polyIndex].polyline.nodeIndices;

        if (nodeIndex < 0)
            nodeIndex = 0;
        if (nodeIndex > nodes.size())
            nodeIndex = nodes.size();

        nodes.insert(nodes.begin() + nodeIndex, id);
    }

    // --------------------
    // TRUE merge system
    // --------------------

    void mergeNodes(int polyA, int polyB, int idxA, int idxB)
    {
        if (polyA < 0 || polyA >= entities.size() ||
            polyB < 0 || polyB >= entities.size())
            return;

        auto &A = entities[polyA].polyline.nodeIndices;
        auto &B = entities[polyB].polyline.nodeIndices;

        if (idxA < 0 || idxA >= A.size() ||
            idxB < 0 || idxB >= B.size())
            return;

        int nodeA = A[idxA];
        int nodeB = B[idxB];

        // average position
        float mx = (nodePool[nodeA].x + nodePool[nodeB].x) * 0.5f;
        float my = (nodePool[nodeA].y + nodePool[nodeB].y) * 0.5f;

        nodePool[nodeA].x = mx;
        nodePool[nodeA].y = my;

        nodePool[nodeB].x = mx;
        nodePool[nodeB].y = my;

        // unify references
        for (auto &e : entities)
        {
            for (auto &id : e.polyline.nodeIndices)
            {
                if (id == nodeB)
                    id = nodeA;
            }
        }
    }

    // --------------------
    // Guides
    // --------------------

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
// Polyline::get (FIXED)
// --------------------

Node Polyline::get(int i) const
{
    return doc->nodePool[nodeIndices[i]];
}

// --------------------
// Embind bindings
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
        .function("get", &Polyline::get);

    class_<Document>("Document")
        .constructor<>()
        .function("createPolyline", &Document::createPolyline)
        .function("addNodeToPolyline", &Document::addNodeToPolyline)
        .function("entityCount", &Document::entityCount)
        .function("getPolyline", &Document::getPolyline, allow_raw_pointers())
        .function("removeNodeFromPolyline", &Document::removeNodeFromPolyline)
        .function("insertNodeInPolyline", &Document::insertNodeInPolyline)
        .function("moveNode", &Document::moveNode)
        .function("mergeNodes", &Document::mergeNodes)
        .function("addGuide", &Document::addGuide)
        .function("guideCount", &Document::guideCount)
        .function("getGuide", &Document::getGuide, allow_raw_pointers())
        .function("removeGuide", &Document::removeGuide)
        .function("moveGuide", &Document::moveGuide);
}